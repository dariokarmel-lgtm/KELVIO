-- =====================================================================
-- Unificar dos cuentas de la misma persona.
--
--   select public.merge_accounts('<id que se queda>', '<id que se borra>');
--
-- Pasa a la cuenta que se queda: los pagos (en un mes repetido queda el
-- mejor: aprobado > pendiente > rechazado),
-- lo que la otra cargó o revisó, y los datos que le falten (país,
-- teléfono, nombre). Después borra la otra cuenta (auth + perfil).
-- Solo se puede ejecutar desde el SQL Editor (service_role / postgres).
--
-- Además:
--  * Los comprobantes de los pagos pasados siguen en la carpeta de la
--    cuenta vieja: se pueden ver si se puede ver el pago que los usa.
--  * payments_guard solo valida la carpeta del comprobante cuando éste
--    cambia (así un admin puede aprobar un pago movido).
-- Se puede correr más de una vez.
-- =====================================================================

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
  if folder = auth.uid()::text or public.can_pay_for(folder::uuid) then
    return true;
  end if;
  -- Carpeta de una cuenta unificada: vale si el usuario ve algún pago que la usa.
  return exists (
    select 1 from payments p
    where split_part(p.receipt_path, '/', 1) = folder
      and (p.instructor_id = auth.uid() or public.can_pay_for(p.instructor_id))
  );
exception when invalid_text_representation then
  return false;
end;
$$;

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
    -- Si otra persona reenvía un pago rechazado, pasa a ser suyo (pago por tercero).
    new.created_by    := case when old.status = 'rejected' and auth.uid() is not null
                               and auth.uid() <> old.instructor_id
                              then auth.uid() else old.created_by end;
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
     and (tg_op = 'INSERT' or new.receipt_path is distinct from old.receipt_path)
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

create or replace function public.merge_accounts(keep uuid, drop_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  moved int;
  skipped int;
begin
  if auth.uid() is not null then
    raise exception 'merge_accounts solo se ejecuta desde el SQL Editor.';
  end if;
  if keep = drop_id or not exists (select 1 from profiles where id = keep)
     or not exists (select 1 from profiles where id = drop_id) then
    raise exception 'Cuentas inválidas.';
  end if;

  update profiles k set
    country_id  = coalesce(k.country_id, d.country_id),
    phone       = coalesce(nullif(k.phone, ''), d.phone),
    full_name   = case when btrim(k.full_name) = '' then d.full_name else k.full_name end,
    start_month = least(k.start_month, d.start_month)
  from profiles d
  where k.id = keep and d.id = drop_id;

  -- Mover pagos sin pasar por payments_guard (que no deja cambiar el instructor).
  alter table payments disable trigger payments_guard;
  -- Mes repetido: queda el mejor (aprobado > pendiente > rechazado; si empatan, el de la cuenta que se queda).
  delete from payments k using payments d
  where k.instructor_id = keep and d.instructor_id = drop_id and k.period = d.period
    and (case d.status when 'approved' then 3 when 'pending' then 2 else 1 end)
      > (case k.status when 'approved' then 3 when 'pending' then 2 else 1 end);
  update payments set instructor_id = keep
  where instructor_id = drop_id
    and period not in (select period from payments where instructor_id = keep);
  get diagnostics moved = row_count;
  select count(*) into skipped from payments where instructor_id = drop_id;
  update payments set created_by  = keep where created_by  = drop_id;
  update payments set reviewed_by = keep where reviewed_by = drop_id;
  alter table payments enable trigger payments_guard;
  update payment_groups set created_by = keep where created_by = drop_id;

  delete from auth.users where id = drop_id;   -- borra también su perfil
  return format('Pagos movidos: %s. Descartados por mes repetido: %s.', moved, skipped);
end;
$$;

revoke all on function public.merge_accounts(uuid, uuid) from public, anon, authenticated;

-- Paso 2: Hebert Sena — queda la cuenta de Gmail (como director), se borra la de Hotmail.
do $$
declare
  g uuid; h uuid; ng int; nh int; r text;
begin
  select count(*), min(id::text)::uuid into ng, g from profiles
   where ((full_name ilike '%sena%' and full_name ~* 'h?erbert|hebert') or email ilike '%hebertsena%' or email ilike '%herbertsena%') and email ilike '%@gmail.%';
  select count(*), min(id::text)::uuid into nh, h from profiles
   where ((full_name ilike '%sena%' and full_name ~* 'h?erbert|hebert') or email ilike '%hebertsena%' or email ilike '%herbertsena%') and email ilike '%@hotmail.%';
  if ng <> 1 or nh <> 1 then
    raise exception 'Se esperaba 1 cuenta Gmail y 1 Hotmail de Hebert Sena; hay % Gmail y % Hotmail. No se cambió nada.', ng, nh;
  end if;
  r := public.merge_accounts(g, h);
  update profiles set role = 'director', active = true, end_month = null where id = g;
  raise notice '%', r;
end $$;

select p.full_name, p.email, p.role, p.active, c.name as pais,
       (select count(*) from payments where instructor_id = p.id) as pagos
from profiles p left join countries c on c.id = p.country_id
where (p.full_name ilike '%sena%' and p.full_name ~* 'h?erbert|hebert') or p.email ilike '%sena%';
