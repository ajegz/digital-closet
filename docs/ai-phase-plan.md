# AI phase plan (Phase 6)

Status: **planned, not started** (2026-10-25). Read [AGENTS.md](../AGENTS.md) first for the architecture, rules and owner preferences.

## What the owner wants

> "Just dump pictures on it, auto arranges it, auto search specific type, auto generate model but 3D style non interactive (hyperrealistic)."

In product terms:

1. **Dump photos, get a catalogued closet.** Select many photos at once; each becomes a piece with its details filled in automatically.
2. **Auto-arrange.** Pieces land in the right collection without manual sorting.
3. **Search by type and description.** "blue linen shirts", "something warm for rain", "work shoes".
4. **Clean catalogue look.** Background removed so pieces look consistent.
5. **Generated studio or on-model image.** A hyper-realistic, non-interactive still render of the piece (3D/studio product-shot style), as an optional extra.

None of this exists yet. Today, bulk upload already creates one piece per photo, but naming and sorting are manual and search is plain text matching over typed fields (`visibleItems()` in `src/main.ts`).

## Principles

- **Suggestions, not silent edits.** AI output is an *estimate* until the owner confirms it. This was the original prototype's promise ("keep confirmed details separate from estimates"). Pieces filled by AI stay `Needs review` until confirmed.
- **The real photo stays the record.** Cutouts and renders are additional images; never overwrite `photo_path`/`thumb_path`. Generated images can alter logos, patterns, colour or fit, so label them "AI-generated" everywhere they appear.
- **Keys stay server-side.** All model calls go through Supabase Edge Functions; provider API keys live in Edge Function secrets. The browser only ever holds the user's session JWT and the publishable key.
- **Cost-aware.** State per-image cost to the owner before enabling; add a per-user daily cap; show progress and failures; never auto-run image generation in bulk without an explicit choice.
- **Offline-tolerant.** Tagging is queued; if offline or the function fails, the piece is still saved and can be tagged later.
- **No gamification**, same design system, both themes, accessibility bar unchanged (see AGENTS.md).

## Feature 1: auto-tagging (do first)

**Flow:** the owner adds one or many photos (optionally a second close-up of the care/brand label) → pieces are created immediately as today → each is queued for tagging → a server function returns suggestions → the piece shows "AI suggested" fields the owner can accept, edit or reject.

**Suggested fields** (map onto existing columns): `name` (e.g. "Light-blue linen shirt"), `category` (one of the user's collections, or a proposed new one), `color`, `material`, `brand` and `size` (from label text when visible), `weather[]`, `occasions[]`, `care`, plus new descriptive tags (`pattern`, `style`, `sleeve`, `fit`, free-form `tags[]`) for search.

**Server:** Edge Function `tag-piece`:
- Auth: require the user's JWT. With the new publishable/secret keys, set `verify_jwt = false` and authorise in code (e.g. `@supabase/server` `withSupabase({ auth: "user" })`).
- Input: `item_id` (and optional label image path). The function downloads the photo from `closet-photos` with the user's session (RLS applies), so it can only read the caller's files.
- Calls a vision-capable model with a strict JSON schema; validates the output against the allowed enums (`WEATHER`, `OCCASIONS`, collection names); writes suggestions back.
- Rate limit per user (e.g. a `ai_usage` table counted per day) and a hard daily cap.

**Data (new migration):**
- `items.ai jsonb`: `{ model, tagged_at, fields: { <field>: { value, confidence } }, tags: [] }`.
- `items.confirmed_fields text[]`: fields the owner accepted or typed themselves; the UI renders other AI-filled values with an "AI" marker.
- `items.tags text[]` (searchable descriptors) with a GIN index.
- Update `src/database.types.ts`, `ClosetItem` in `src/types.ts`, `fromRow`/`toRow` in `src/sync.ts`; local records get `aiStatus: "queued" | "running" | "done" | "failed"`.

**UI:**
- Piece sheet and detail: AI-filled values show a small "AI" chip; "Accept all" plus per-field accept/edit; confirming marks `status = confirmed`.
- Bulk add: progress ("Tagging 3 of 12…"), then a review list sorted by lowest confidence first.
- Today's tasks: "Review 5 AI suggestions" replaces "Fill in details" when there's AI output to confirm.
- Collections: if the model proposes a category that doesn't exist, suggest creating it rather than creating it silently.

**Acceptance:** 10 varied real photos get correct category ≥9/10 and sensible colour/material; nothing is written to confirmed fields without the owner's action; works with sync on two devices; RLS test proves a user can't tag or read another user's item; costs per photo measured and reported.

## Feature 2: smart search

1. **Free first:** extend `visibleItems()` to match `tags[]`, `pattern`, `material`, `weather`, `occasions`, and synonyms (e.g. "pants" ↔ "trousers").
2. **Natural language:** an Edge Function `parse-search` turns "something warm for rain" into a structured filter (`weather: ["Cold","Rainy"]`, `category: Outerwear`); the client applies it locally. Debounce; only call when the query looks like a sentence.
3. **Later (optional):** embeddings with `pgvector` for "find similar pieces".

**Acceptance:** "blue shirt", "linen", "rain jacket", "work" return the expected pieces; plain keyword search still works offline.

## Feature 3: background removal (cutouts)

- On demand per piece ("Clean up photo") and optionally after tagging.
- Output: transparent WebP stored as `<user_id>/<item_id>/<version>-cutout.webp`; new column `items.cutout_path`; synced like photos (version in the path).
- Display: a "Catalogue look" toggle (per device, `localStorage`) shows cutouts on a soft neutral tile in grids; detail page can switch between original and cutout.
- Watch the ~300 MB storage headroom (AGENTS.md). Cutouts at 480–800px WebP keep this small.

## Feature 4: generated studio / on-model renders (optional, opt-in)

- Per-piece action "Create studio shot" with style choices: *studio product shot (ghost mannequin)*, *flat lay*, *on model*. Hyper-realistic still image, not interactive 3D.
- Input: the cutout (or original) plus the confirmed details as the prompt; output stored as `<version>-render.webp`, new column `items.render_path`, plus `items.ai.render = { model, prompt, created_at }`.
- Always labelled "AI-generated"; never replaces the real photo; owner can delete it.
- Confirm cost before each batch; daily cap; show the original side by side so the owner can judge fidelity.
- Provider: whichever image model the implementing agent has access to (e.g. OpenAI image generation). Call it from an Edge Function, with the key as a secret.

## Database and storage changes (summary)

New migration(s), each with RLS tests and advisor checks:

```
items: ai jsonb, confirmed_fields text[] default '{}', tags text[] default '{}', cutout_path text, render_path text
index items_tags_gin on items using gin (tags)
ai_usage (user_id, day, kind, count) with owner-only RLS, used for daily caps
storage: same closet-photos bucket and folder policy; new file suffixes -cutout.webp, -render.webp
```

The bucket allows only `image/webp` and `image/jpeg`. Transparent cutouts must be WebP (or the bucket policy updated).

## Decisions the owner must make before building

1. **Providers and keys:** which vision model for tagging and which image model for cutouts and renders. Keys are added by the owner as Supabase Edge Function secrets (never pasted in chat or committed).
2. **Budget:** acceptable cost per photo for tagging and per render, plus the daily caps.
3. **Privacy:** photos will be sent to those providers; confirm that's acceptable and show a one-line notice in the app.
4. **Storage:** stay within the free 1 GB (shared) or upgrade if renders are wanted at scale.

## Suggested order and checkpoints

1. Migration + types + sync mapping for `ai`, `confirmed_fields`, `tags` (no AI calls yet); UI for "AI" chips and confirm flow, tested with fake suggestions.
2. `tag-piece` Edge Function + queue + bulk review flow → measure accuracy and cost on 10 real photos → owner sign-off.
3. Smart search (free part first, then `parse-search`).
4. Cutouts.
5. Renders (opt-in), after the owner approves cost and provider.

Each step: typecheck/build, browser test at phone and desktop widths in both themes, axe-core scan, RLS test, clean up test data, focused commit. Pushing to `main` deploys.
