# Phase 3 plan: accounts and cloud sync (Supabase)

Status: **backend created and app integration built 2026-10-22**: `src/sync.ts` (engine), `src/account.ts` (sheet), `src/supabase.ts` (client). Waiting on the email-template change and the first real sign-in to test sync end to end.

| | |
|---|---|
| Project | `digital-closet` (ref `hjmeabidvbkemmwcfifz`), org MJ's Personal Projects, free plan, $0/month |
| Region | Singapore (`ap-southeast-1`) |
| Migrations | `supabase/migrations/` (source of truth; the SQL below is the original sketch) |
| Client config | `.env.local` (gitignored); template in `.env.example` |
| Verified | RLS tested with two throwaway users in a rolled-back transaction; security advisor: no findings |

## Goals

- The closet works exactly as today without an account (local-first, IndexedDB).
- Signing in backs everything up and syncs it across your phone and laptop.
- Each person can only ever read or change their own pieces and photos.

## Architecture in one picture

```
 UI ──reads/writes──▶ IndexedDB (source of truth on the device)
                          │  dirty rows + tombstones (outbox)
                          ▼
                    sync engine ──push/pull──▶ Supabase Postgres (items, collections)
                          │
                          └──upload/download──▶ Supabase Storage (closet-photos, private)
```

- **Local-first.** The UI never waits on the network. Saves go to IndexedDB, are marked dirty, and sync in the background.
- **Sync triggers:** sign-in, app start, a few seconds after each save, the tab becoming visible again, and coming back online.
- **Conflicts:** last write wins on the client's `updated_at`. That's fine for one person on a couple of devices.
- **Deletes** become tombstones (`deleted_at`) so other devices learn about them, and are purged after 30 days.
- **Pull cursor:** a server-set `synced_at` column (trigger), so a device asks only for "rows changed since I last looked", independent of device clocks.

## Database schema

```sql
-- Collections (today's "categories"). Name is unique per user.
create table public.collections (
  id          uuid primary key,                       -- generated on the device
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null check (char_length(name) between 1 and 30),
  position    int  not null default 0,
  updated_at  timestamptz not null,
  deleted_at  timestamptz,
  synced_at   timestamptz not null default now(),
  unique (user_id, name)
);

create table public.items (
  id            uuid primary key,                     -- crypto.randomUUID() on the device
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  name          text not null check (char_length(name) between 1 and 120),
  category      text not null,                        -- collection name, same as the app today
  brand         text,                                 -- null instead of the app's "To identify"
  color         text,
  status        text not null default 'needs_review' check (status in ('needs_review', 'confirmed')),
  favorite      boolean not null default false,
  size          text,
  material      text,
  weather       text[] check (weather <@ array['Hot','Mild','Cold','Rainy']),
  occasions     text[] check (occasions <@ array['Casual','Work','Formal','Sport','Lounge']),
  price         numeric(12,2) check (price >= 0),
  purchased_on  date,
  store         text,
  care          text,
  photo_path    text,                                 -- <user_id>/<item_id>/full.webp
  thumb_path    text,                                 -- <user_id>/<item_id>/thumb.webp
  created_at    timestamptz not null,
  updated_at    timestamptz not null,                 -- set by the device; used for last-write-wins
  deleted_at    timestamptz,
  synced_at     timestamptz not null default now()    -- set by the server; used as the pull cursor
);

create index items_user_synced on public.items (user_id, synced_at);
create index collections_user_synced on public.collections (user_id, synced_at);

-- synced_at always comes from the server clock.
create function public.touch_synced_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.synced_at := now(); return new; end; $$;
create trigger items_synced before insert or update on public.items
  for each row execute function public.touch_synced_at();
create trigger collections_synced before insert or update on public.collections
  for each row execute function public.touch_synced_at();
```

### Row Level Security

```sql
alter table public.items enable row level security;
alter table public.collections enable row level security;
revoke all on public.items, public.collections from anon;

-- Same four policies on both tables (shown for items).
create policy "Own items: read"   on public.items for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own items: add"    on public.items for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Own items: change" on public.items for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Own items: remove" on public.items for delete to authenticated using ((select auth.uid()) = user_id);
```

`(select auth.uid())` and `to authenticated` follow Supabase's RLS performance guidance; signed-out requests get nothing.

## Photo storage

- **Bucket** `closet-photos`, **private**, 2 MB per file, `image/webp` and `image/jpeg` only.
- **Paths** `<user_id>/<item_id>/full.webp` and `thumb.webp`. The first folder is the owner, which the policies check.
- **Policies** on `storage.objects` (select, insert, update, delete), all `to authenticated` with:
  `bucket_id = 'closet-photos' and (storage.foldername(name))[1] = (select auth.uid())::text`
- **Upload** the already-compressed images from Phase 2 (about 106 KB + 22 KB per piece).
- **Display** from IndexedDB as today. On a new device, thumbnails are downloaded on demand with the user's session and cached locally, so there's no long-lived public URL.
- At that size, the free 1 GB of storage holds roughly 7,500 pieces.

## Auth

- **Email one-time code** (6 digits typed into the app). Recommended over magic links: a link opens in the browser rather than an installed home-screen app, and a code needs no redirect-URL setup.
- **Google sign-in** can follow later. It needs a Google Cloud OAuth client, which you'd create.
- **Built-in email sending is for testing only** (a handful of emails per hour). Real use needs a custom SMTP sender, for example Resend; see "Decisions needed".
- The **publishable key** (`sb_publishable_…`) goes in the client; it's designed to be public and RLS does the protecting. The **secret key** is never needed by this app.

## App changes

- `@supabase/supabase-js`; `.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (gitignored), plus a committed `.env.example`.
- Local records gain `dirty`, `deletedAt` and photo-upload state; a new `sync.ts` holds the push/pull engine.
- **Account sheet** from the top bar: sign in with email code, a sync status line ("Synced 2 min ago", "Syncing…", "Offline, will sync later"), sign out.
- **First sign-in:** pieces made while signed out are uploaded to the new account. On a second device, both sets merge by id.
- **Sign out:** finish syncing, then clear this device's copy (a shared phone shouldn't keep your closet).
- After the migration: run Supabase's security and performance advisors and fix anything they flag.

## Build order

1. Create the project (after your OK and the cost check), apply the schema, bucket and policies as migrations, run advisors.
2. Client, env and the account sheet with email-code sign-in.
3. Push: upload local items and photos; then pull: download and merge.
4. Tombstones, background triggers, offline handling, sign-out cleanup.
5. Test two browsers signed into one account, plus a second account that must see nothing.

## Decisions (2026-10-22)

- **Project:** new dedicated project on the current account (its second and last free slot).
- **Region:** Singapore.
- **Who signs in:** just MJ for now. Turn off public sign-ups once that account exists.
- **Email:** Supabase's built-in sender while it's one user. Set up a custom SMTP sender (for example Resend) before inviting anyone.
- **Refinements while building:** the trigger function lives in a non-exposed `private` schema, and collection names are unique only among non-deleted collections (partial unique index), so a deleted collection can be recreated.
- **Later:** purging tombstones older than 30 days isn't scheduled yet; the sync engine or a cron job will do it.
