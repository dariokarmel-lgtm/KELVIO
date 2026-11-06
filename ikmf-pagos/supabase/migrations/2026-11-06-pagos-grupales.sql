-- =====================================================================
-- Pagos grupales: un director (o admin) registra UN pago que cubre a
-- varios instructores, con uno o más comprobantes y observaciones.
--
-- Cada instructor sigue teniendo su fila en payments (una por mes), unida
-- al grupo por group_id. Los comprobantes del grupo se guardan en la
-- carpeta "g-<id del grupo>/" del bucket "receipts".
-- Se puede correr más de una vez.
-- =====================================================================

create table if not exists public.payment_groups (
  id            uuid primary key default gen_random_uuid(),
  country_id    uuid not null references public.countries(id),
  paid_on       date not null default current_date,
  method        text,
  reference     text,
  note          text,
  total_amount  numeric(12,2) not null check (total_amount > 0),
  currency      text not null check (currency ~ '^[A-Z]{3}$'),
  receipt_paths text[] not null default '{}',
  created_by    uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

alter table public.payments
  add column if not exists group_id uuid references public.payment_groups(id) on delete set null;
create index if not exists payments_group_idx on public.payments(group_id);

-- ¿El usuario actual puede crear / editar pagos grupales de este país?
-- Admin: cualquiera. Director activo: solo el suyo.
create or replace function public.can_manage_country(country uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles me
    where me.id = auth.uid()
      and (me.role = 'admin'
           or (me.role = 'director' and me.active and me.country_id = country))
  );
$$;

-- ¿Puede ver el grupo? Quien lo gestiona, o un instructor incluido en él.
create or replace function public.can_see_group(gid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from payment_groups g where g.id = gid and public.can_manage_country(g.country_id))
      or exists (select 1 from payments p where p.group_id = gid and p.instructor_id = auth.uid());
$$;

alter table public.payment_groups enable row level security;

drop policy if exists payment_groups_select on public.payment_groups;
create policy payment_groups_select on public.payment_groups
  for select to authenticated using (public.can_see_group(id));

drop policy if exists payment_groups_insert on public.payment_groups;
create policy payment_groups_insert on public.payment_groups
  for insert to authenticated
  with check (public.can_manage_country(country_id) and created_by = auth.uid());

drop policy if exists payment_groups_update on public.payment_groups;
create policy payment_groups_update on public.payment_groups
  for update to authenticated
  using (public.can_manage_country(country_id))
  with check (public.can_manage_country(country_id));

drop policy if exists payment_groups_delete on public.payment_groups;
create policy payment_groups_delete on public.payment_groups
  for delete to authenticated
  using (public.is_admin()
         or (created_by = auth.uid()
             and not exists (select 1 from public.payments p where p.group_id = payment_groups.id)));

grant select, insert, update, delete on public.payment_groups to authenticated;

-- Comprobantes: la carpeta "g-<grupo>" la ve quien puede ver el grupo y
-- solo escribe en ella quien gestiona el país del grupo.
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
  return public.can_manage(folder::uuid);
exception when invalid_text_representation then
  return false;
end;
$$;

create or replace function public.can_write_receipt_folder(folder text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
begin
  if folder like 'g-%' then
    return exists (select 1 from payment_groups g
                   where g.id = substr(folder, 3)::uuid and public.can_manage_country(g.country_id));
  end if;
  return public.can_access_receipt_folder(folder);
exception when invalid_text_representation then
  return false;
end;
$$;

drop policy if exists receipts_insert on storage.objects;
create policy receipts_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts'
              and public.can_write_receipt_folder((storage.foldername(name))[1]));

-- payments_guard: un pago de un grupo puede usar un comprobante del grupo
-- (carpeta g-<grupo>), y el grupo tiene que ser del país del instructor.
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
      where g.id = new.group_id and g.country_id = p.country_id
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
