# Digital Closet: project context for coding agents

Read this first. It describes what exists, how it fits together, the rules this codebase follows, and what the owner expects. The next phase (AI) is planned in [docs/ai-phase-plan.md](docs/ai-phase-plan.md).

**At the start of every chat/session in this project, and before generating or regenerating a garment image, read [Garment image standard](docs/garment-image-standard.md).** This applies throughout this folder, including all intake, processing and archive subfolders. Search the web first; use a matching, inspected product image as a generation reference when available. Otherwise use only the owner's original garment photos. The linked standard defines the conditional buttoned, clean, crease-minimized retail presentation and required evidence.

- **Owner:** MJ (GitHub `ajegz`). Single user today; sign-ups are disabled.
- **Live:** https://ajegz.github.io/digital-closet/ (GitHub Pages, deploys on every push to `main`).
- **Repo:** https://github.com/ajegz/digital-closet (public; never commit secrets or personal email addresses).

## What the app is

A mobile-first, installable web app for cataloguing a personal wardrobe:

- **Closet:** pieces with photo, name, collection (category), brand, colour, size, material, price, purchase date, store, weather, occasions, care notes, and a status (Needs review / Confirmed). Search, collection chips, clothing type/brand/status filters, Favorites and New quick views, grid/list layouts. Clothing types are inferred locally from piece names; sleeve and zip styles can overlap garment shapes. Brand choices ignore casing and extra whitespace, while keeping subbrands separate.
- **Outfits:** saved combinations of pieces, shown as photo collages.
- **Clothing-type convention:** long-sleeve tees belong to **Long sleeves**, excluded from **T-shirt**. Cards show separate colour-coded type labels; the selected clothing-type filter uses the same colour. Colour supplements readable text and has light/dark token pairs. These are browsing suggestions and do not rewrite saved item names.
- **Worn:** a log of what was worn on each day (from an outfit or picked pieces). It drives the wear stats: times worn, last worn, cost per wear, most worn, and "not worn in 90 days". A Rediscover strip surfaces unworn pieces.
- **Today's tasks:** up to 3 practical tasks built from what the closet is missing (log today's outfit, add a photo, confirm pieces, add pieces, fill details).
- **Account:** email one-time-code sign-in, cloud backup and sync across devices, Appearance (System/Light/Dark) and Install controls.
- **Installable and offline:** web manifest, service worker, works offline; data syncs when back online.

## Stack

| Layer | Choice |
|---|---|
| Build | Vite 8, TypeScript 7 (strict, `noUnusedLocals`), no UI framework: plain DOM and template strings |
| Local data | IndexedDB (`digital-closet`, version 2): stores `items`, `outfits`, `wearLogs`, `meta` |
| Cloud | Supabase project `digital-closet` (ref `hjmeabidvbkemmwcfifz`, region `ap-southeast-1`, free plan): Postgres + Auth + Storage via `@supabase/supabase-js` 2 |
| Hosting | GitHub Pages via `.github/workflows/deploy.yml` (Node 24) |
| Runtime | Node 24 locally (`node -v` → v24.x) |

```bash
npm install
npm run dev        # http://localhost:5173 (needs .env.local for cloud features; works local-only without it)
npm run typecheck
npm run build      # tsc && vite build → dist/
npm run preview    # serve dist/ at :4173 (service worker only registers in production builds)
```

`.env.local` (gitignored; template in `.env.example`):

```
VITE_SUPABASE_URL=https://hjmeabidvbkemmwcfifz.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

The publishable key is public by design (Row Level Security protects data). The deploy workflow reads both from GitHub repository **variables**. **Never** put a secret key (`sb_secret_…`, `service_role`, or any AI provider key) in client code, `.env.local`, GitHub variables, or the repo.

## File map

| Path | What it holds |
|---|---|
| `index.html` | All markup: tab bar, screens (closet, item detail, outfits, worn, collections), dialogs (piece sheet, add menu, picker, account), toast, theme-before-paint script |
| `src/main.ts` (~1,300 lines) | App state, routing, rendering and events. Sections: helpers, Today's tasks, routing, rendering, outfits and wear log, feedback banner, add/edit sheet, collections, events, start |
| `src/sync.ts` | Local-first sync engine: pull then push, last-write-wins on `updated_at`, keyset cursors, photo upload/download, tombstones, auth (send/verify code, sign out) |
| `src/storage.ts` | IndexedDB wrapper (`loadItems`, `saveItem`, `loadRecords`/`saveRecord` for outfits and wear logs, `loadMeta`/`saveMeta`, `clearAll`) |
| `src/types.ts` | `ClosetItem`, `Outfit`, `WearLog`, `Collection`, enums (`WEATHER`, `OCCASIONS`), `UNKNOWN` placeholder |
| `src/item-filters.ts` | Name-based clothing type suggestions and normalized brand filter keys; these do not change saved item details |
| `src/photos.ts` | Upload-time compression: EXIF-rotated, WebP (JPEG fallback), 1600px detail + 480px thumbnail; data-URL/Blob helpers |
| `src/account.ts` | Account sheet: email → code → signed-in view with sync status and sign-out |
| `src/device.ts` | Theme preference, install prompt, service worker registration |
| `src/supabase.ts` | Supabase client (null when env is missing → app runs local-only) and `PHOTO_BUCKET` |
| `src/database.types.ts` | Hand-maintained copy of the generated Supabase types; update it after every migration |
| `src/icons.ts` | Inline SVG icons and the mascot "Hangie" |
| `src/styles.css` | Design tokens (light + `:root[data-theme="dark"]`) and all component styles, mobile-first with `min-width` breakpoints at 480/600/900/1200px |
| `public/sw.js` | Service worker: app-shell + hashed-asset cache, network-first pages, never caches Supabase. Bump `VERSION` when changing caching |
| `public/manifest.webmanifest`, `public/icons/` | PWA manifest and icons |
| `supabase/migrations/` | Source of truth for the database. Add new numbered files; never edit applied ones |
| `docs/phase-3-plan.md` | Sync/auth architecture and decisions |
| `.claude/skills/` | Design system (`duolingo-style`) and supporting skills used by Claude Code |

## Data model

**Local (IndexedDB) and cloud (Postgres) mirror each other.** Every synced record has a client-generated UUID `id`, `created_at`, `updated_at` (set by the device, used for last-write-wins), `deleted_at` (tombstone) and `synced_at` (set by a server trigger, used as the pull cursor).

| Table | Key columns |
|---|---|
| `items` | `name`, `category`, `brand`, `color` (null = unknown; locally `"To identify"`), `status` (`needs_review`/`confirmed`), `favorite`, `size`, `material`, `weather text[]`, `occasions text[]`, `price numeric(12,2)`, `purchased_on date`, `store`, `care`, `photo_path`, `thumb_path` |
| `collections` | `name` (unique per user among non-deleted), `position` |
| `outfits` | `name`, `item_ids uuid[]` |
| `wear_logs` | `worn_on date`, `item_ids uuid[]` (≥1), `outfit_id` (informational, no FK) |

Local-only sync bookkeeping on records: `dirty` (unsent change; `undefined` counts as dirty), `photoDirty`, `photoPath`/`thumbPath`, `deletedAt`, `remoteSyncedAt`.

**Storage:** private bucket `closet-photos` (2 MB per file, `image/webp` or `image/jpeg`). Paths are `<user_id>/<item_id>/<version>-full.webp` and `-thumb.webp`; a new photo gets a new version so other devices notice. Policies allow each user only their own first-level folder.

**Row Level Security (every table):** `enable row level security`; `revoke all … from anon`; four policies `to authenticated` using `(select auth.uid()) = user_id`. Test new policies with two throwaway users inside a transaction that is never committed, then run the Supabase security advisor:

```sql
begin;
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'rls-test-a@example.invalid'),
  ('00000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', 'rls-test-b@example.invalid');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
-- insert a row as A; then switch claims to B and assert B sees/updates/deletes 0 rows; `set local role anon` must be refused
rollback;
```

## How the app works internally

- **Rendering:** module-level state (`items`, `outfits`, `wearLogs`, `collections`, `tab`, filters) and a full `render()` that rewrites the active screen with template strings. Always pass user text through `escapeHtml()` when interpolating.
- **Routing:** hash routes `#closet`, `#favorites`, `#recent`, `#outfits`, `#worn`, `#collections`, `#collection-<name>`, `#item-<id>`. `applyHash()` also closes open sheets (Back closes a sheet like a native app).
- **Saving:** change the in-memory record, set `dirty: true` (and `photoDirty: true` for a new photo) and a new `updatedAt`, `render()`, then `persistAndSync(saveItem(...))`/`saveRecord(...)`. `requestSync()` debounces a sync pass.
- **Deleting:** when signed in, write a tombstone (`deletedAt`, `dirty`) so other devices learn about it; signed out, delete outright. Always offer Undo in the banner.
- **Sync pass** (`runOnce`): pull collections, items (downloading new photo versions), outfits, wear logs; then push the same. Sign-out syncs, warns about unsent changes, then clears IndexedDB.
- **Dialogs** are native `<dialog>` sheets (bottom sheet on phones, centred card ≥600px) with a sticky action bar. Errors inside an open sheet are shown inline (`.form-error`), because the toast sits underneath the modal.
- **Today's tasks** progress lives in `meta.taskLog` (per day, local only).

## Auth and email

- Email OTP only (`signInWithOtp` / `verifyOtp` type `email`); no passwords, no magic links.
- Custom SMTP through Gmail (owner's account, app password). The "Magic link or OTP" and "Confirm sign up" templates send only `{{ .Token }}`.
- **Sign-ups are disabled** in Supabase; only the owner's account exists. Switch to a transactional sender (e.g. Resend with a verified domain) before inviting anyone.

## Design rules (must follow)

The source of truth is [.claude/skills/duolingo-style/SKILL.md](.claude/skills/duolingo-style/SKILL.md). The essentials:

- **"Duolingo style" means the visual design only.** Chunky 3D buttons (`box-shadow: 0 4px 0 <ledge>`, press drops 4px), 2px borders with 4px bottom ledge on cards, Nunito type, bright palette, bottom tab bar on phones and left rail ≥900px, bottom sheets, friendly mascot and feedback banners.
- **No gamification.** The owner explicitly removed XP, levels and streaks. Do not add points, levels, streaks, badges, leaderboards or rewards.
- **Use tokens** from `:root` in `src/styles.css`; every colour has a dark-theme value under `:root[data-theme="dark"]`. Add a dark value for any new token. Never hard-code colours.
- **Contrast:** text pairs must meet WCAG AA (4.5:1; primary button labels are 19px/800 so 3:1 applies). White text never sits on bright green, sky, flame or sun fills.
- **Mobile:** design at 360–430px first; touch targets ≥44px; inputs 16px (prevents iOS zoom); no horizontal page scroll; `100dvh` and safe-area insets. Sideways-scrolling rows inside sheets need `min-height: max-content` or they collapse.
- **Accessibility:** current state is 0 axe-core (WCAG 2.2 AA + best practices) violations on every screen and sheet in both themes. Keep it that way: labelled controls, `aria-pressed` on toggles, `aria-live` for changing counts, focus-visible rings, skip link, reduced-motion respected.
- **Copy:** short, second person, warm, plain verbs ("Add to closet", "Log it"); errors explain what to do; no guilt.

## Gotchas learned the hard way

- **Temporal dead zone:** don't call helpers (e.g. `dayKey()`) while initialising top-level `let` state; `const` helpers declared later aren't initialised yet. TypeScript won't catch it.
- **Service worker:** the app starts after async IndexedDB reads, so the `load` event has usually fired; `device.ts` registers immediately when `document.readyState === "complete"`.
- **IndexedDB upgrades:** bump `DB_VERSION` in `storage.ts` and create new stores in `onupgradeneeded` (guarded with `objectStoreNames.contains`).
- **Vite `base: "./"`:** the build must work under `/digital-closet/`; use relative URLs for public assets.
- **Collections merge by name across devices**, because each device starts with default collections.
- **Storage quota:** the Supabase free plan's 1 GB of file storage is shared at organisation level with another project; about 300 MB is free. Anything that stores extra images (cutouts, renders) must account for this.

## Working agreements with the owner

- Photo intake is `0INPUT/`. The agent manages grouping, analysis and organization under `1PROCESSING/`, `2PROCESSED/` and `3NEEDS-INFO/`; follow [docs/photo-intake.md](docs/photo-intake.md). Keep these private photo folders out of Git. Preserve original files, and only mark a garment processed after its generated image is checked and its website sync is verified.
- “Check the new batch in input” means complete the established intake workflow through private website sync, unless the owner explicitly asks for inspection only. Keep optional unknowns unresolved and Needs review instead of stopping the whole batch for them. Existing cost/provider/photo-sharing permissions still apply; files appearing alone do not start an unattended job.
- Ask before anything that costs money, creates paid resources, or sends data to a new third-party service; state the cost first.
- Secrets never go in chat, the repo, or the client. Server-side keys live in Supabase Edge Function secrets.
- Verify in the browser (phone width and desktop, light and dark) and with typecheck/build before calling something done; test with clearly labelled throwaway data and delete it afterwards.
- Commit in focused steps with descriptive messages. Pushing to `main` deploys to production.
