-- Jalankan sekali lewat `npm run db:migrate` atau Supabase SQL Editor.
-- Semua akses runtime memakai Secret key dari backend; tidak ada policy publik.

create table if not exists public.app_state (
  id text primary key check (id = 'primary'),
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.app_state (id, state)
values ('primary', '{}'::jsonb)
on conflict (id) do nothing;

create table if not exists public.app_sessions (
  kind text not null check (kind in ('worker', 'comment')),
  session_id text not null,
  encrypted_value text not null,
  updated_at timestamptz not null default now(),
  primary key (kind, session_id)
);

alter table public.app_state enable row level security;
alter table public.app_sessions enable row level security;
revoke all on table public.app_state from anon, authenticated;
revoke all on table public.app_sessions from anon, authenticated;
