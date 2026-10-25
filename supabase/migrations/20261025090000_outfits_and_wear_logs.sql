-- Phase 4: saved outfits and a log of what was worn. Same sync shape as items/collections:
-- client UUIDs, client updated_at for last-write-wins, tombstones, and a server-set synced_at cursor.

create table public.outfits (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  item_ids    uuid[] not null default '{}' check (cardinality(item_ids) <= 60),
  created_at  timestamptz not null,
  updated_at  timestamptz not null,
  deleted_at  timestamptz,
  synced_at   timestamptz not null default now()
);

-- outfit_id is informational, not a foreign key: devices sync independently, and a log can
-- reach the server before (or outlive) the outfit it was made from.
create table public.wear_logs (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  worn_on     date not null,
  item_ids    uuid[] not null default '{}' check (cardinality(item_ids) between 1 and 60),
  outfit_id   uuid,
  created_at  timestamptz not null,
  updated_at  timestamptz not null,
  deleted_at  timestamptz,
  synced_at   timestamptz not null default now()
);

-- Leading user_id also serves the auth.users cascade.
create index outfits_user_synced on public.outfits (user_id, synced_at);
create index wear_logs_user_synced on public.wear_logs (user_id, synced_at);

create trigger outfits_touch_synced before insert or update on public.outfits
  for each row execute function private.touch_synced_at();
create trigger wear_logs_touch_synced before insert or update on public.wear_logs
  for each row execute function private.touch_synced_at();

alter table public.outfits enable row level security;
alter table public.wear_logs enable row level security;
revoke all on public.outfits, public.wear_logs from anon;

create policy "Own outfits: read" on public.outfits
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own outfits: add" on public.outfits
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Own outfits: change" on public.outfits
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Own outfits: remove" on public.outfits
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Own wear logs: read" on public.wear_logs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own wear logs: add" on public.wear_logs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Own wear logs: change" on public.wear_logs
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Own wear logs: remove" on public.wear_logs
  for delete to authenticated using ((select auth.uid()) = user_id);
