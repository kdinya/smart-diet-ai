-- Run once in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.food_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 180),
  meal_type text not null default 'breakfast' check (meal_type in ('breakfast', 'lunch', 'dinner')),
  grams numeric(9,2) not null default 0 check (grams >= 0),
  kcal numeric(9,2) not null default 0 check (kcal >= 0),
  protein numeric(9,2) not null default 0 check (protein >= 0),
  fat numeric(9,2) not null default 0 check (fat >= 0),
  carbs numeric(9,2) not null default 0 check (carbs >= 0),
  entry_date date not null default current_date,
  created_at timestamptz not null default now()
);

-- Safe migration for existing installations created before meal categories.
alter table public.food_entries add column if not exists meal_type text not null default 'breakfast' check (meal_type in ('breakfast', 'lunch', 'dinner'));

create table if not exists public.weight_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  value numeric(7,2) not null check (value > 0 and value < 1000),
  entry_date date not null default current_date,
  created_at timestamptz not null default now(),
  unique (user_id, entry_date)
);

create index if not exists food_entries_user_date_idx on public.food_entries (user_id, entry_date desc);
create index if not exists weight_entries_user_date_idx on public.weight_entries (user_id, entry_date desc);

alter table public.food_entries enable row level security;
alter table public.weight_entries enable row level security;

drop policy if exists "Users manage their own food entries" on public.food_entries;
create policy "Users manage their own food entries" on public.food_entries
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage their own weight entries" on public.weight_entries;
create policy "Users manage their own weight entries" on public.weight_entries
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.food_entries to authenticated;
grant select, insert, update, delete on public.weight_entries to authenticated;

-- Goals and profile synced across devices (one row per user).
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

drop policy if exists "Users manage their own profile" on public.user_profiles;
create policy "Users manage their own profile" on public.user_profiles
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.user_profiles to authenticated;
