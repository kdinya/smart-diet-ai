-- Run once in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.food_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 180),
  meal_type text not null default 'breakfast' check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
  grams numeric(9,2) not null default 0 check (grams >= 0),
  kcal numeric(9,2) not null default 0 check (kcal >= 0),
  protein numeric(9,2) not null default 0 check (protein >= 0),
  fat numeric(9,2) not null default 0 check (fat >= 0),
  carbs numeric(9,2) not null default 0 check (carbs >= 0),
  entry_date date not null default current_date,
  created_at timestamptz not null default now()
);

-- Safe migration for existing installations created before meal categories.
alter table public.food_entries add column if not exists meal_type text not null default 'breakfast' check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack'));

-- Allow the snack category on installations created before it existed.
alter table public.food_entries drop constraint if exists food_entries_meal_type_check;
alter table public.food_entries add constraint food_entries_meal_type_check check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack'));

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

-- My products: saved foods synced per record (one row per product).
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  grams numeric(9,2) not null default 100 check (grams >= 0),
  kcal numeric(9,2) not null default 0 check (kcal >= 0),
  protein numeric(9,2) not null default 0 check (protein >= 0),
  fat numeric(9,2) not null default 0 check (fat >= 0),
  carbs numeric(9,2) not null default 0 check (carbs >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_user_name_idx on public.products (user_id, lower(name));

alter table public.products enable row level security;

drop policy if exists "Users manage their own products" on public.products;
create policy "Users manage their own products" on public.products
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.products to authenticated;

-- Friends and cloud-only product sharing.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  friend_code text not null unique check (friend_code ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$'),
  display_name text not null default '' check (char_length(display_name) <= 40),
  created_at timestamptz not null default now()
);

create or replace function public.generate_friend_code()
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  candidate text;
  i integer;
begin
  loop
    candidate := '';
    for i in 1..8 loop
      candidate := candidate || substr(alphabet, 1 + (get_byte(uuid_send(gen_random_uuid()), i - 1) % length(alphabet)), 1);
    end loop;
    exit when not exists (select 1 from public.profiles where friend_code = candidate);
  end loop;
  return candidate;
end;
$$;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  insert into public.profiles (user_id, friend_code, display_name)
  values (new.id, public.generate_friend_code(), left(coalesce(new.raw_user_meta_data->>'name', ''), 40))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

-- Backfill accounts created before this feature was installed.
insert into public.profiles (user_id, friend_code, display_name)
select u.id, public.generate_friend_code(), left(coalesce(u.raw_user_meta_data->>'name', ''), 40)
from auth.users u
on conflict (user_id) do nothing;

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references auth.users(id) on delete cascade,
  addressee uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  constraint friendships_no_self check (requester <> addressee)
);

create unique index if not exists friendships_pair_unique_idx
  on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index if not exists friendships_requester_status_idx on public.friendships (requester, status);
create index if not exists friendships_addressee_status_idx on public.friendships (addressee, status);

-- Private, server-only rolling-window counter for friend-code lookup attempts.
create table if not exists public.friend_request_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count between 1 and 10)
);
alter table public.friend_request_limits enable row level security;
revoke all on public.friend_request_limits from public, anon, authenticated;

create or replace function public.request_friend(code text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  caller uuid := auth.uid();
  target uuid;
  existing public.friendships%rowtype;
  current_window timestamptz;
  current_count integer;
  normalized_code text := upper(btrim(coalesce(code, '')));
begin
  if caller is null then
    raise exception 'Authentication required';
  end if;

  insert into public.friend_request_limits (user_id, window_started_at, attempt_count)
  values (caller, now(), 1)
  on conflict (user_id) do nothing;
  select window_started_at, attempt_count into current_window, current_count
    from public.friend_request_limits where user_id = caller for update;
  if current_window <= now() - interval '1 hour' then
    update public.friend_request_limits
      set window_started_at = now(), attempt_count = 1 where user_id = caller;
  elsif current_count >= 10 then
    return 'already';
  else
    update public.friend_request_limits
      set attempt_count = attempt_count + 1 where user_id = caller;
  end if;

  if normalized_code !~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$' then
    return 'not_found';
  end if;
  select user_id into target from public.profiles where friend_code = normalized_code;
  if target is null or target = caller then
    return 'not_found';
  end if;

  -- Serialize requests for the pair to avoid duplicate rows and races.
  perform pg_advisory_xact_lock(hashtextextended(least(caller::text, target::text) || ':' || greatest(caller::text, target::text), 0));
  select * into existing from public.friendships
    where (requester = caller and addressee = target) or (requester = target and addressee = caller)
    for update;
  if found then
    if existing.status = 'pending' and existing.requester = target then
      update public.friendships set status = 'accepted' where id = existing.id;
      return 'ok';
    end if;
    return 'already';
  end if;

  insert into public.friendships (requester, addressee, status) values (caller, target, 'pending');
  return 'ok';
end;
$$;
revoke all on function public.request_friend(text) from public, anon;
grant execute on function public.request_friend(text) to authenticated;
revoke all on function public.generate_friend_code() from public, anon, authenticated;
revoke all on function public.create_profile_for_new_user() from public, anon, authenticated;

create table if not exists public.product_shares (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  grams numeric(9,2) not null check (grams between 0 and 10000),
  kcal numeric(9,2) not null check (kcal between 0 and 10000),
  protein numeric(9,2) not null check (protein between 0 and 10000),
  fat numeric(9,2) not null check (fat between 0 and 10000),
  carbs numeric(9,2) not null check (carbs between 0 and 10000),
  created_at timestamptz not null default now(),
  constraint product_shares_no_self check (from_user <> to_user)
);
create index if not exists product_shares_inbox_idx on public.product_shares (to_user, from_user, created_at);
create index if not exists product_shares_sender_idx on public.product_shares (from_user, created_at);

create or replace function public.enforce_unread_share_limit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  pending_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.from_user::text || ':' || new.to_user::text, 0));
  select count(*) into pending_count from public.product_shares
    where from_user = new.from_user and to_user = new.to_user;
  if pending_count >= 20 then
    raise exception 'Share limit reached';
  end if;
  return new;
end;
$$;
drop trigger if exists product_shares_unread_limit on public.product_shares;
create trigger product_shares_unread_limit before insert on public.product_shares
  for each row execute function public.enforce_unread_share_limit();
revoke all on function public.enforce_unread_share_limit() from public, anon, authenticated;

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.product_shares enable row level security;

drop policy if exists "Users read related profiles" on public.profiles;
create policy "Users read related profiles" on public.profiles for select to authenticated
  using (user_id = auth.uid() or exists (
    select 1 from public.friendships f
    where (f.requester = auth.uid() and f.addressee = profiles.user_id)
       or (f.addressee = auth.uid() and f.requester = profiles.user_id)
  ));
drop policy if exists "Users update own display name" on public.profiles;
create policy "Users update own display name" on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Users read own friendship rows" on public.friendships;
create policy "Users read own friendship rows" on public.friendships for select to authenticated
  using (requester = auth.uid() or addressee = auth.uid());
drop policy if exists "Addressee accepts friendship" on public.friendships;
create policy "Addressee accepts friendship" on public.friendships for update to authenticated
  using (addressee = auth.uid() and status = 'pending')
  with check (addressee = auth.uid() and status = 'accepted');
drop policy if exists "Participants delete friendship" on public.friendships;
create policy "Participants delete friendship" on public.friendships for delete to authenticated
  using (requester = auth.uid() or addressee = auth.uid());

drop policy if exists "Participants read product shares" on public.product_shares;
create policy "Participants read product shares" on public.product_shares for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());
drop policy if exists "Friends share products" on public.product_shares;
create policy "Friends share products" on public.product_shares for insert to authenticated
  with check (from_user = auth.uid() and exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester = auth.uid() and f.addressee = product_shares.to_user)
        or (f.addressee = auth.uid() and f.requester = product_shares.to_user))
  ));
drop policy if exists "Recipients delete product shares" on public.product_shares;
create policy "Recipients delete product shares" on public.product_shares for delete to authenticated
  using (to_user = auth.uid());

revoke all on public.profiles, public.friendships, public.product_shares from public, anon, authenticated;
grant select, update (display_name) on public.profiles to authenticated;
grant select, update (status), delete on public.friendships to authenticated;
grant select, insert, delete on public.product_shares to authenticated;
