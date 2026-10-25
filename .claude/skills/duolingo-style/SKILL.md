---
name: duolingo-style
description: Digital Closet's playful, Duolingo-inspired, mobile-first design system — chunky 3D buttons, bright palette, rounded type, bottom-tab app shell and the hanger mascot. Visual style only: no game mechanics. Use for any UI work in this project (new screens, components, restyling, copy, empty states, celebrations). It is the source of truth when design skills disagree (see §0); pair with mobile-ux-optimizer for viewport, touch and safe-area rules.
---

# Duolingo-style design system (Digital Closet)

Inspired by Duolingo's energy — bright, chunky, friendly, rewarding — but it is **our own** brand. Never use Duolingo's name, owl, logo, fonts or illustrations. Our mascot is **Hangie**, a green hanger buddy (see `src/icons.ts`).

The tokens live in `:root` at the top of `src/styles.css`. Use the variables; never hard-code a colour that has a token.

## 0. Skill priority

This file is the project's committed design brief **and** its design-engineering layer. Several other design skills are installed in `.claude/skills/`; when they disagree, the higher item wins:

1. **The user's request in the conversation.**
2. **duolingo-style (this file)** — tokens, components, motion values, copy voice and the no-gamification rule (§5). Every other skill's advice is filtered through it.
3. **mobile-ux-optimizer** — viewport, touch targets, safe areas, gestures. It overrides this file only on those mechanics.
4. **frontend-design** — the process for a new screen (plan → review against the brief → build → critique) and UX-writing rules. Its "generic tells" list (all-caps labels, eyebrows over headings, `A · B` meta strings) loses where this file pins a choice: uppercase button and tab labels are part of our brief. Use the list as a polish prompt instead: drop an eyebrow or a middle dot when it carries no information.
5. **duo-\* skills** — *rationale only*: why a pattern works and when it doesn't. Never take token values, easing curves or fonts from them (they say so themselves).
   - `duo-design` — motion, celebration, character and accessibility rationale
   - `duo-gamification` — reference only for feedback and celebration *feel*; never a reason to add XP, levels or rewards (§5)
   - `duo-retention` — reference only for habit reasoning (e.g. its frequency check); never a reason to add streaks (§5)
   - `duo-voice` — copy for banners, errors, empty states and notifications
   - `duolingo` — the router; use it only to choose among the four above

Routing notes:

- When the `duolingo` router hands UI craft to "design-engineering", that means **this file**. Don't suggest installing `AgentsORG/design-engineering`.
- Links to duo skills that aren't installed (`duo-product`, `duo-growth`, `duo-streak-mechanics`, …) are dead ends: skip them, and don't install more of the pack without asking the user.
- Motion conflict: the bouncy `--pop` easing is only for small moments of delight (favouriting, a finished task). Everything else uses `ease-out` (§4).
- Nothing from the duo-\* references licenses Duolingo's fonts, owl, names or brand assets.

## 1. Principles

1. **Phone first, desktop second.** Write base CSS for a 360–430px screen, then add `min-width` media queries. The same app on desktop is a centered column with a left rail instead of a bottom tab bar.
2. **Feels like an app, not a website.** Fixed bottom tab bar, sticky top bar with stats, bottom sheets instead of centered modals on phones, no hover-only affordances.
3. **Chunky and tactile.** Every pressable thing has a visible "ledge" and physically drops when pressed.
4. **Warm feedback, never pressure.** Confirm each save with a friendly banner, keep copy short and warm, no guilt or fake urgency.
5. **Readable first.** Bright colours are for surfaces, fills and icons. Text must meet WCAG AA (see §2 contrast rules).

## 2. Tokens

| Token | Value | Use |
|---|---|---|
| `--leaf` / `--leaf-ledge` | `#58cc02` / `#46a302` | progress fills, mascot, success icons, selected states |
| `--leaf-button` / `--leaf-button-ledge` | `#46a302` / `#357a01` | primary button face / ledge |
| `--leaf-text` / `--leaf-tint` | `#3f7d00` / `#d7ffb8` | success text / success background |
| `--sky` / `--sky-text` / `--sky-tint` / `--sky-line` | `#1cb0f6` / `#0b70aa` / `#ddf4ff` / `#84d8ff` | info, links, selected chip/tab |
| `--flame` / `--flame-text` | `#ff9600` / `#b25f00` | task icon, warm accents |
| `--sun` / `--sun-ledge` | `#ffc800` / `#e5a800` | highlights, the "needs review" tint |
| `--berry` / `--berry-text` / `--berry-tint` | `#ff4b4b` / `#bb2525` / `#ffdfe0` | favourites, delete, errors |
| `--grape` | `#ce82ff` | collections accent |
| `--ink` | `#3c3c3c` | body and headings |
| `--muted` | `#6f6f6f` | secondary text (4.7:1 on white) |
| `--faint` | `#afafaf` | disabled, placeholders, decorative only — **never body text** |
| `--line` | `#e5e5e5` | borders and card ledges |
| `--surface` | `#f7f7f7` | inputs, image wells |
| `--bg` | `#ffffff` | page |

**Contrast rules (checked):** white on `--leaf` is only 2.1:1 — never put white text on bright green, sky, flame or sun. Primary button labels are white on `--leaf-button` (3.2:1) and must be **≥19px and weight 800+** (WCAG "large text"). Small coloured text uses the `*-text` variants (all ≥4.5:1 on white and on their own `*-tint`).

**Type:** `Nunito` (Google Fonts, 600/700/800/900). Headings 800–900, tight letter-spacing (`-.01em`). Labels on buttons and tabs are **uppercase, 800, `.04em` tracking**. Body 16px (never below 14px on phones; inputs exactly 16px so iOS doesn't zoom).

**Shape:** radius 16px for buttons, cards and inputs; 12px for chips; 999px for progress bars and pills; 24px for sheet tops.

**Spacing:** 4px grid. Screen gutter 16px on phones, 24px from 600px up.

## 3. Components

**Chunky button.** Face colour, `box-shadow: 0 4px 0 <ledge>`, `min-height: 50px`. On `:active`: `transform: translateY(4px); box-shadow: none`. Transition 100ms. Variants: primary (leaf-button), secondary (white face, 2px `--line` border, ledge `--line`, label `--sky-text`), danger (white face, label `--berry-text`).

**Card.** White, `border: 2px solid var(--line)`, `border-bottom-width: 4px`, radius 16px. Pressable cards get the same drop on `:active` (translateY(2px) + bottom border 2px).

**Chip.** 2px border `--line`, ledge 3px, radius 12px, min-height 40px, label 800. Selected: `--sky-tint` background, `--sky-line` border, `--sky-text` label.

**Progress bar.** Height 16px, track `--line`, fill `--leaf`, radius 999px, with a lighter 4px highlight strip inset near the top of the fill (`::after`, white at 30% opacity). Animate width 300ms ease-out.

**Top bar.** Screen title on the left; the account button (with its sync-status dot) on the right. No score or streak counters.

**Bottom tab bar (phones).** Fixed, white, 2px top border, `padding-bottom: env(safe-area-inset-bottom)`. 4 tabs + a raised center Add button (56px circle, leaf-button face with ledge). Each tab ≥56px tall, icon 26px above a 11px uppercase label. Active tab: icon and label `--sky-text`, a `--sky-tint` rounded background with 2px `--sky-line` border.

**Left rail (≥900px).** The same tabs stacked vertically with labels, plus a full-width primary "Add item" button. Content column max 1040px.

**Bottom sheet.** `<dialog>` pinned to the bottom on phones, full width, radius 24px on top, a 40×5px grab handle, slides up 200ms ease-out, max-height 92dvh with internal scroll. From 600px up it becomes a centered 520px card.

**Feedback banner (toast).** Slides up above the tab bar. Success: `--leaf-tint` background, `--leaf-text` bold label, mascot or check icon. Error: `--berry-tint` / `--berry-text`. Undo is a text button in the banner. Auto-hide after 5s.

**Empty state.** Mascot (96px) + one short headline (800) + one line of help + one chunky button. Never a bare "No results".

## 4. Motion

- Press: 100ms. Sheets and banners: 200ms `ease-out` slide. Progress: 300ms `ease-out`.
- Small delight moments (a heart filling, a task ticking) pop with `cubic-bezier(.34,1.56,.64,1)` over 300ms.
- Everything respects `@media (prefers-reduced-motion: reduce)` — switch to instant changes.

## 5. No gamification

"Duolingo-style" here means the **visual design only** (MJ, 2026-10-25). Don't add XP, points, levels, streaks, badges, leaderboards or reward mechanics unless MJ explicitly asks.

What stays, because it's practical rather than a game:

- **Today's tasks**: up to 3 tasks built from what the closet is actually missing, easiest first: log what you wore today → add a photo to 1 piece → confirm 2 pieces → add 3 new pieces (only while the closet has fewer than 20) → fill in details on 3 pieces. Only real progress counts; finished tasks stay ticked for the day; each open task opens the work; "All caught up" when nothing is missing; no penalty for skipping.
- **Feedback banners** that confirm what happened ("Saved", "Deleted · Undo", "Today's tasks done").
- **Wear stats** (Phase 4: times worn, last worn, cost per wear, pieces not worn lately) are information, not scores.

## 6. Copy voice

Short, second person, upbeat, plain words. Buttons are verbs ("Add piece", "Save", "Undo"). Confirm specifics ("Nice! Linen shirt is in your closet."). No exclamation spam — one per message max. No guilt ("You haven't…") — invite instead ("Add a piece to start a streak").

## 7. Checklist before shipping a screen

- [ ] Works at 360px wide with no horizontal scroll; tab bar never covers content (bottom padding = tab height + safe area)
- [ ] Every target ≥44×44px; inputs 16px font
- [ ] Uses tokens; no white text on bright fills; small coloured text uses `*-text` tokens
- [ ] Pressables have the ledge + press drop; focus-visible ring (3px `--sky-line`)
- [ ] Empty state has mascot + action; success shows a feedback banner
- [ ] Reduced-motion respected; `100dvh` instead of `100vh`
