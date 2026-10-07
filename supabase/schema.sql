-- Run once in the Supabase SQL Editor.
create table public.measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  racket text,
  note text,
  mass_g real not null,
  balance_cm real not null,
  pivot_cm real not null,
  amplitude_deg real not null,
  g real not null,
  period_s real not null,
  period_sigma_s real,
  cycles real,
  source text check (source in ('live', 'file')),
  swingweight real not null,
  swingweight_sigma real,
  i_pivot real,
  i_cm real
);

create index measurements_user_created_idx on public.measurements (user_id, created_at desc);

alter table public.measurements enable row level security;

grant select, insert, delete on public.measurements to authenticated;

create policy "select own measurements" on public.measurements
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own measurements" on public.measurements
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "delete own measurements" on public.measurements
  for delete to authenticated using ((select auth.uid()) = user_id);
