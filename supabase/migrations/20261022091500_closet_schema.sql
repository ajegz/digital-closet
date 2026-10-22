-- Digital Closet: pieces and collections, one owner per row.
-- Rows are created on the device (ids are client UUIDs) and synced; see docs/phase-3-plan.md.

create schema if not exists private;

create table public.collections (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null check (char_length(name) between 1 and 30),
  position    int  not null default 0,
  updated_at  timestamptz not null,
  deleted_at  timestamptz,
  synced_at   timestamptz not null default now()
);

-- A name only has to be unique among collections that still exist, so a deleted one can be recreated.
create unique index collections_user_name_live on public.collections (user_id, name) where deleted_at is null;

create table public.items (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  name          text not null check (char_length(name) between 1 and 120),
  category      text not null,
  brand         text,
  color         text,
  status        text not null default 'needs_review' check (status in ('needs_review', 'confirmed')),
  favorite      boolean not null default false,
  size          text,
  material      text,
  weather       text[] check (weather <@ array['Hot', 'Mild', 'Cold', 'Rainy']),
  occasions     text[] check (occasions <@ array['Casual', 'Work', 'Formal', 'Sport', 'Lounge']),
  price         numeric(12, 2) check (price >= 0),
  purchased_on  date,
  store         text,
  care          text,
  photo_path    text,
  thumb_path    text,
  created_at    timestamptz not null,
  updated_at    timestamptz not null,
  deleted_at    timestamptz,
  synced_at     timestamptz not null default now()
);

-- Pull queries are "this user's rows changed since my cursor".
create index items_user_synced on public.items (user_id, synced_at);
create index collections_user_synced on public.collections (user_id, synced_at);

-- synced_at always comes from the server clock, never the device.
create function private.touch_synced_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.synced_at := now();
  return new;
end;
$$;

create trigger items_touch_synced before insert or update on public.items
  for each row execute function private.touch_synced_at();
create trigger collections_touch_synced before insert or update on public.collections
  for each row execute function private.touch_synced_at();

-- Row Level Security: every row is visible and editable only by its owner.
alter table public.items enable row level security;
alter table public.collections enable row level security;
revoke all on public.items, public.collections from anon;

create policy "Own items: read" on public.items
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own items: add" on public.items
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Own items: change" on public.items
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Own items: remove" on public.items
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Own collections: read" on public.collections
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own collections: add" on public.collections
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Own collections: change" on public.collections
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Own collections: remove" on public.collections
  for delete to authenticated using ((select auth.uid()) = user_id);
