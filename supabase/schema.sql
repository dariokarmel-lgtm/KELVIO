-- ============================================================
-- KALVIO — esquema inicial de Supabase
-- Correr completo en el SQL Editor de Supabase (proyecto nuevo o
-- limpio). Reemplaza la capa de localStorage del prototipo.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- profiles ----------
-- Datos de cuenta que no viven en auth.users (Supabase Auth ya
-- guarda email/password). Se crea automáticamente al registrarse
-- vía el trigger de más abajo.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  phone text,
  phone_verified boolean not null default false,
  email_verified boolean not null default false,
  biometric boolean not null default false,
  security_code text,
  duress_status text not null default 'none' check (duress_status in ('none','step1','confirmed')),
  duress_code text,
  plan text not null default 'free' check (plan in ('free','pro')),
  lang text not null default 'es',
  created_at timestamptz not null default now()
);

-- ---------- recipients ----------
create table if not exists recipients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  status text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  invite_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create index if not exists recipients_user_id_idx on recipients(user_id);
create unique index if not exists recipients_invite_token_idx on recipients(invite_token);

-- ---------- switches ----------
create table if not exists switches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('legado','sesion')),
  name text not null,
  interval_ms bigint not null,
  grace_ms bigint,
  alarm_ms bigint,
  next_due timestamptz not null,
  verifier_id uuid references recipients(id) on delete set null,
  message text not null,
  channels jsonb not null default '{"email":true,"sms":false,"whatsapp":false,"call":false}'::jsonb,
  location boolean not null default false,
  off boolean not null default false,
  panic_visible boolean not null default true,
  reminders jsonb,
  triggered_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists switches_user_id_idx on switches(user_id);
create index if not exists switches_next_due_idx on switches(next_due) where off = false and triggered_at is null;

-- ---------- switch_recipients (N:N) ----------
create table if not exists switch_recipients (
  switch_id uuid not null references switches(id) on delete cascade,
  recipient_id uuid not null references recipients(id) on delete cascade,
  primary key (switch_id, recipient_id)
);

-- ---------- history ----------
create table if not exists history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  switch_id uuid references switches(id) on delete set null,
  type text not null,
  note text not null,
  ts timestamptz not null default now()
);

create index if not exists history_user_id_idx on history(user_id);

-- ============================================================
-- Row Level Security — cada usuario solo ve/edita lo suyo.
-- Las Netlify Functions usan la service_role key, que se salta RLS
-- (necesario para el chequeo automático y el envío de alertas).
-- ============================================================

alter table profiles enable row level security;
alter table recipients enable row level security;
alter table switches enable row level security;
alter table switch_recipients enable row level security;
alter table history enable row level security;

create policy "own profile" on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "own recipients" on recipients
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own switches" on switches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own switch_recipients" on switch_recipients
  for all using (
    exists (select 1 from switches s where s.id = switch_id and s.user_id = auth.uid())
  )
  with check (
    exists (select 1 from switches s where s.id = switch_id and s.user_id = auth.uid())
  );

create policy "own history" on history
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- Trigger: crear el profile automáticamente al registrarse.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
