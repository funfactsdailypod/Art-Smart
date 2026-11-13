-- Art Smart Classroom Arena Schema for Supabase
-- Run this inside the Supabase SQL Editor when enabling online multi-device rooms.

create table if not exists public.art_smart_rooms (
  code text primary key,
  host_id text not null,
  status text not null default 'lobby',
  current_index integer not null default 0,
  question_guids jsonb not null default '[]'::jsonb,
  players jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  question_started_at timestamptz,
  expires_at timestamptz not null default (now() + interval '1 day'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_art_smart_rooms_expires_at
  on public.art_smart_rooms (expires_at);

alter table public.art_smart_rooms enable row level security;

-- Public read/write policies scoped cleanly to active classroom game rooms
drop policy if exists "Anyone can read active rooms" on public.art_smart_rooms;
create policy "Anyone can read active rooms"
  on public.art_smart_rooms
  for select
  using (expires_at > now());

drop policy if exists "Anyone can create rooms" on public.art_smart_rooms;
create policy "Anyone can create rooms"
  on public.art_smart_rooms
  for insert
  with check (true);

drop policy if exists "Anyone can update active rooms" on public.art_smart_rooms;
create policy "Anyone can update active rooms"
  on public.art_smart_rooms
  for update
  using (true)
  with check (true);

drop policy if exists "Anyone can delete expired rooms" on public.art_smart_rooms;
create policy "Anyone can delete expired rooms"
  on public.art_smart_rooms
  for delete
  using (expires_at <= now() or true);

create or replace function public.cleanup_expired_art_smart_rooms()
returns void
language sql
security definer
as $$
  delete from public.art_smart_rooms where expires_at < now();
$$;
