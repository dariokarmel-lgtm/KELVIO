-- =====================================================================
-- IKMF — Control de pagos mensuales de instructores
-- Migración completa: tablas + funciones de permisos + RLS + Storage.
--
-- Correr ENTERO en el SQL Editor de un proyecto de Supabase NUEVO
-- (no compartir con KALVIO ni InstructorLog: usa su propia tabla
-- `profiles` y su propio trigger sobre auth.users).
--
-- Roles:
--   instructor → ve y carga SOLO sus propios pagos.
--   director   → ve y valida los pagos de los instructores de SU país.
--                Sus propios pagos los valida un admin.
--   admin      → ve todo, administra países y asigna roles.
--
-- La seguridad real está acá (RLS + triggers), no en el frontend:
-- aunque alguien manipule el JS, la base no le deja ver ni tocar
-- datos de otro país ni auto-aprobarse un pago.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('instructor', 'director', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------
create table if not exists public.countries (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  code        text not null unique check (code ~ '^[A-Z]{2}$'),
  currency    text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  default_fee numeric(12,2) not null default 0 check (default_fee >= 0),
  created_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  phone       text,
  role        public.user_role not null default 'instructor',
  country_id  uuid references public.countries(id) on delete set null,
  -- Cuota mensual propia; null = usa la cuota por defecto del país.
  monthly_fee numeric(12,2) check (monthly_fee is null or monthly_fee >= 0),
  -- Primer mes que se le cobra (para calcular meses adeudados).
  start_month date not null default date_trunc('month', now())::date
              check (extract(day from start_month) = 1),
  -- Un instructor nuevo queda inactivo hasta que el director de su país lo activa.
  active      boolean not null default false,
  -- Baja: último mes que se le cobra. null = no está dado de baja.
  -- Las altas, ediciones de email y bajas se hacen con la Netlify Function
  -- manage-user (necesita la service_role para tocar auth.users).
  end_month   date check (end_month is null or extract(day from end_month) = 1),
  created_at  timestamptz not null default now()
);

-- Para proyectos creados con una versión anterior de este archivo.
alter table public.profiles add column if not exists end_month date
  check (end_month is null or extract(day from end_month) = 1);

create index if not exists profiles_country_idx on public.profiles(country_id);

create table if not exists public.payments (
  id             uuid primary key default gen_random_uuid(),
  instructor_id  uuid not null references public.profiles(id) on delete cascade,
  -- Mes que se paga, siempre el día 1 (ej. 2026-10-01 = octubre 2026).
  period         date not null check (extract(day from period) = 1),
  amount         numeric(12,2) not null check (amount > 0),
  currency       text not null check (currency ~ '^[A-Z]{3}$'),
  paid_on        date not null default current_date,
  method         text,
  reference      text,
  note           text,
  -- Ruta dentro del bucket "receipts": <instructor_id>/<archivo>
  receipt_path   text,
  status         public.payment_status not null default 'pending',
  reviewed_by    uuid references public.profiles(id) on delete set null,
  reviewed_at    timestamptz,
  review_comment text,
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (instructor_id, period)
);

create index if not exists payments_period_idx on public.payments(period);
create index if not exists payments_status_idx on public.payments(status);

-- ---------------------------------------------------------------------
-- Funciones de permisos (security definer para no recursar en RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- ¿El usuario actual puede administrar al perfil `target`?
-- Admin: a cualquiera. Director activo: solo a los instructores de su país
-- (un director nunca valida sus propios pagos ni los de otro director).
create or replace function public.can_manage(target uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from profiles me
    join profiles t on t.id = target
    where me.id = auth.uid()
      and (
        me.role = 'admin'
        or (me.role = 'director' and me.active
            and me.country_id is not null
            and me.country_id = t.country_id
            and t.role = 'instructor')
      )
  );
$$;

-- Para las policies de Storage: la primera carpeta del path es el id del instructor.
create or replace function public.can_access_receipt_folder(folder text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  if folder = auth.uid()::text then
    return true;
  end if;
  return public.can_manage(folder::uuid);
exception when invalid_text_representation then
  return false;
end;
$$;

-- ---------------------------------------------------------------------
-- Alta automática de perfil al registrarse
-- ---------------------------------------------------------------------
create or replace function public.ikmf_handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into profiles (id, email, full_name, phone, country_id)
  values (
    new.id,
    new.email,
    coalesce(meta->>'full_name', ''),
    nullif(meta->>'phone', ''),
    (select c.id from countries c where c.id::text = meta->>'country_id')
  );
  return new;
end;
$$;

drop trigger if exists ikmf_on_auth_user_created on auth.users;
create trigger ikmf_on_auth_user_created
  after insert on auth.users
  for each row execute function public.ikmf_handle_new_user();

-- ---------------------------------------------------------------------
-- Guardas de campos sensibles en profiles
-- ---------------------------------------------------------------------
create or replace function public.profiles_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Sin JWT = SQL Editor / service_role: se permite todo (bootstrap del primer admin).
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  new.id         := old.id;
  new.email      := old.email;
  new.role       := old.role;
  new.created_at := old.created_at;
  new.country_id := old.country_id;
  new.end_month  := old.end_month;  -- la baja solo se da por manage-user
  if old.end_month is not null then
    new.active := old.active;       -- y la reactivación también
  end if;

  if old.id = auth.uid() then
    -- Un usuario editando su propio perfil solo puede tocar nombre y teléfono.
    new.monthly_fee := old.monthly_fee;
    new.start_month := old.start_month;
    new.active      := old.active;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard();

-- ---------------------------------------------------------------------
-- Reglas de negocio de payments
-- ---------------------------------------------------------------------
create or replace function public.payments_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  manager boolean := auth.uid() is null or public.can_manage(new.instructor_id);
begin
  if tg_op = 'UPDATE' then
    new.instructor_id := old.instructor_id;
    new.created_by    := old.created_by;
    new.created_at    := old.created_at;
  end if;
  new.updated_at := now();

  if not manager then
    -- El propio instructor cargando / corrigiendo su pago.
    if not exists (select 1 from profiles where id = auth.uid() and active) then
      raise exception 'Tu cuenta todavía no fue activada por el director de tu país.';
    end if;
    if tg_op = 'UPDATE' and old.status = 'approved' then
      raise exception 'Este pago ya fue aprobado y no se puede modificar.';
    end if;
    if new.receipt_path is null or new.receipt_path = '' then
      raise exception 'Tenés que adjuntar el comprobante de pago.';
    end if;
    if split_part(new.receipt_path, '/', 1) <> new.instructor_id::text then
      raise exception 'Ruta de comprobante inválida.';
    end if;
    -- Todo lo que carga el instructor entra (o vuelve) a revisión.
    new.status      := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.review_comment := case when tg_op = 'UPDATE' then old.review_comment else null end;
  else
    -- Director del país / admin validando o cargando un pago manual.
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
      raise exception 'Indicá el motivo del rechazo.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists payments_guard on public.payments;
create trigger payments_guard
  before insert or update on public.payments
  for each row execute function public.payments_guard();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.countries enable row level security;
alter table public.profiles  enable row level security;
alter table public.payments  enable row level security;

-- countries: lectura pública (el formulario de registro lista los países).
drop policy if exists countries_select on public.countries;
create policy countries_select on public.countries
  for select to anon, authenticated using (true);

drop policy if exists countries_admin_write on public.countries;
create policy countries_admin_write on public.countries
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.can_manage(id));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.can_manage(id))
  with check (id = auth.uid() or public.can_manage(id));

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete to authenticated using (public.is_admin());

-- payments
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (instructor_id = auth.uid() or public.can_manage(instructor_id));

drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments
  for insert to authenticated
  with check (instructor_id = auth.uid() or public.can_manage(instructor_id));

drop policy if exists payments_update on public.payments;
create policy payments_update on public.payments
  for update to authenticated
  using (instructor_id = auth.uid() or public.can_manage(instructor_id))
  with check (instructor_id = auth.uid() or public.can_manage(instructor_id));

drop policy if exists payments_delete on public.payments;
create policy payments_delete on public.payments
  for delete to authenticated
  using ((instructor_id = auth.uid() and status <> 'approved') or public.is_admin());

-- ---------------------------------------------------------------------
-- Storage: bucket privado para comprobantes (imágenes o PDF, máx. 5 MB)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts', 'receipts', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do nothing;

drop policy if exists receipts_select on storage.objects;
create policy receipts_select on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts'
         and public.can_access_receipt_folder((storage.foldername(name))[1]));

drop policy if exists receipts_insert on storage.objects;
create policy receipts_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts'
              and public.can_access_receipt_folder((storage.foldername(name))[1]));

-- Sin update/delete para usuarios: los comprobantes quedan como registro
-- (al re-subir se crea un archivo nuevo). Solo un admin puede borrar.
drop policy if exists receipts_admin_delete on storage.objects;
create policy receipts_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and public.is_admin());

-- ---------------------------------------------------------------------
-- Datos iniciales (editables desde la pantalla de Administración)
-- ---------------------------------------------------------------------
insert into public.countries (name, code, currency, default_fee) values
  ('Argentina', 'AR', 'ARS', 0),
  ('Uruguay',   'UY', 'UYU', 0),
  ('Chile',     'CL', 'CLP', 0),
  ('México',    'MX', 'MXN', 0),
  ('España',    'ES', 'EUR', 0),
  ('Israel',    'IL', 'ILS', 0)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- PRIMER ADMIN: registrate desde la web y después corré (cambiando el mail):
--
--   update public.profiles
--   set role = 'admin', active = true
--   where email = 'tu-mail@ejemplo.com';
-- ---------------------------------------------------------------------
