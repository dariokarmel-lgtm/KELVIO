-- =====================================================================
-- Pago grupal:
--  * El admin puede hacer un pago grupal de VARIOS países
--    (payment_groups.country_id = null).
--  * Además de instructores, se puede pagar la cuota de directores: el
--    admin, de cualquiera; un director, de los otros directores de su país.
--    (Un director sigue sin poder editar ni dar de baja a otro director:
--    solo ver su perfil y cargar / ver sus pagos.)
-- Se puede correr más de una vez.
-- =====================================================================

alter table public.payment_groups alter column country_id drop not null;

-- ¿El usuario actual puede ver y cargar pagos de `target`?
-- Lo que permite can_manage, más: un director activo con los otros
-- directores de su país.
create or replace function public.can_pay_for(target uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.can_manage(target) or exists (
    select 1
    from profiles me
    join profiles t on t.id = target
    where me.id = auth.uid()
      and me.role = 'director' and me.active
      and me.country_id is not null
      and me.country_id = t.country_id
      and t.role = 'director'
      and t.id <> me.id
  );
$$;

-- Perfiles: un director ve también a los otros directores de su país
-- (solo lectura: el update sigue usando can_manage).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.can_pay_for(id));

-- Pagos
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (instructor_id = auth.uid() or public.can_pay_for(instructor_id));

drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments
  for insert to authenticated
  with check (instructor_id = auth.uid() or public.can_pay_for(instructor_id));

drop policy if exists payments_update on public.payments;
create policy payments_update on public.payments
  for update to authenticated
  using (instructor_id = auth.uid() or public.can_pay_for(instructor_id))
  with check (instructor_id = auth.uid() or public.can_pay_for(instructor_id));

-- Grupo: lo ve quien gestiona su país (o el admin, si es de varios
-- países), y quien puede ver alguno de sus pagos.
create or replace function public.can_see_group(gid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from payment_groups g where g.id = gid and public.can_manage_country(g.country_id))
      or exists (select 1 from payments p where p.group_id = gid
                 and (p.instructor_id = auth.uid() or public.can_pay_for(p.instructor_id)));
$$;

-- can_manage_country(null) = solo admin (grupo de varios países).
create or replace function public.can_manage_country(country uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles me
    where me.id = auth.uid()
      and (me.role = 'admin'
           or (country is not null and me.role = 'director' and me.active and me.country_id = country))
  );
$$;

-- Comprobantes: la carpeta de una persona la usa quien puede pagar por ella.
create or replace function public.can_access_receipt_folder(folder text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  if folder like 'g-%' then
    return public.can_see_group(substr(folder, 3)::uuid);
  end if;
  if folder = auth.uid()::text then
    return true;
  end if;
  return public.can_pay_for(folder::uuid);
exception when invalid_text_representation then
  return false;
end;
$$;

-- payments_guard: el grupo tiene que ser del país de la persona, salvo que
-- sea un grupo de varios países (solo admin).
create or replace function public.payments_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  reviewer boolean := auth.uid() is null or public.is_admin();
  own      boolean := new.instructor_id = auth.uid();
begin
  if tg_op = 'UPDATE' then
    new.instructor_id := old.instructor_id;
    new.created_by    := old.created_by;
    new.created_at    := old.created_at;
    own := old.instructor_id = auth.uid();
  end if;
  new.updated_at := now();

  if new.group_id is not null and new.group_id is distinct from (case when tg_op = 'UPDATE' then old.group_id end) then
    if not exists (
      select 1 from payment_groups g join profiles p on p.id = new.instructor_id
      where g.id = new.group_id
        and (g.country_id is null or g.country_id = p.country_id)
        and (auth.uid() is null or public.can_manage_country(g.country_id))
    ) then
      raise exception 'Pago grupal inválido.' using hint = 'ikmf:group_invalid';
    end if;
  end if;

  if coalesce(new.receipt_path, '') <> ''
     and split_part(new.receipt_path, '/', 1) <> new.instructor_id::text
     and not (new.group_id is not null and split_part(new.receipt_path, '/', 1) = 'g-' || new.group_id::text) then
    raise exception 'Ruta de comprobante inválida.' using hint = 'ikmf:receipt_path';
  end if;

  if reviewer then
    if tg_op = 'INSERT' or new.status is distinct from old.status then
      if new.status in ('approved', 'rejected') then
        new.reviewed_by := auth.uid();
        new.reviewed_at := now();
      else
        new.reviewed_by := null;
        new.reviewed_at := null;
      end if;
    end if;
    if new.status = 'rejected' and coalesce(btrim(new.review_comment), '') = '' then
      raise exception 'Indicá el motivo del rechazo.' using hint = 'ikmf:reject_reason';
    end if;
    return new;
  end if;

  -- Instructor (propio) o director del país (RLS ya validó que puede).
  if tg_op = 'UPDATE' and old.status = 'approved' then
    raise exception 'Este pago ya fue aprobado y no se puede modificar.' using hint = 'ikmf:already_approved';
  end if;
  if own then
    if not exists (select 1 from profiles where id = auth.uid() and active) then
      raise exception 'Tu cuenta todavía no fue activada por el director de tu país.' using hint = 'ikmf:not_active';
    end if;
    if coalesce(new.receipt_path, '') = '' then
      raise exception 'Tenés que adjuntar el comprobante de pago.' using hint = 'ikmf:receipt_required';
    end if;
  end if;

  new.status      := 'pending';
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.review_comment := case when tg_op = 'UPDATE' then old.review_comment else null end;
  return new;
end;
$$;
