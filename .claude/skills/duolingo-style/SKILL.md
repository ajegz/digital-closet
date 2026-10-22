---
name: duolingo-style
description: Digital Closet's playful, Duolingo-inspired, mobile-first design system — chunky 3D buttons, bright palette, rounded type, bottom-tab app shell, XP/streak/quest game loop and the hanger mascot. Use for any UI work in this project (new screens, components, restyling, copy, empty states, celebrations). Pair with mobile-ux-optimizer for viewport, touch and safe-area rules.
---

# Duolingo-style design system (Digital Closet)

Inspired by Duolingo's energy — bright, chunky, friendly, rewarding — but it is **our own** brand. Never use Duolingo's name, owl, logo, fonts or illustrations. Our mascot is **Hangie**, a green hanger buddy (see `src/icons.ts`).

The tokens live in `:root` at the top of `src/styles.css`. Use the variables; never hard-code a colour that has a token.

## 1. Principles

1. **Phone first, desktop second.** Write base CSS for a 360–430px screen, then add `min-width` media queries. The same app on desktop is a centered column with a left rail instead of a bottom tab bar.
2. **Feels like an app, not a website.** Fixed bottom tab bar, sticky top bar with stats, bottom sheets instead of centered modals on phones, no hover-only affordances.
3. **Chunky and tactile.** Every pressable thing has a visible "ledge" and physically drops when pressed.
4. **Reward progress, never shame.** Celebrate each saved piece (+XP), keep copy short and warm, no guilt or fake urgency.
5. **Readable first.** Bright colours are for surfaces, fills and icons. Text must meet WCAG AA (see §2 contrast rules).

## 2. Tokens

| Token | Value | Use |
|---|---|---|
| `--leaf` / `--leaf-ledge` | `#58cc02` / `#46a302` | progress fills, mascot, success icons, selected states |
| `--leaf-button` / `--leaf-button-ledge` | `#46a302` / `#357a01` | primary button face / ledge |
| `--leaf-text` / `--leaf-tint` | `#3f7d00` / `#d7ffb8` | success text / success background |
| `--sky` / `--sky-text` / `--sky-tint` / `--sky-line` | `#1cb0f6` / `#0b70aa` / `#ddf4ff` / `#84d8ff` | info, links, selected chip/tab |
| `--flame` / `--flame-text` | `#ff9600` / `#b25f00` | streak icon / streak number |
| `--sun` / `--sun-ledge` | `#ffc800` / `#e5a800` | XP, rewards, level badge |
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

**Progress bar.** Height 16px, track `--line`, fill `--leaf` (or `--sun` for XP), radius 999px, with a lighter 4px highlight strip inset near the top of the fill (`::after`, white at 30% opacity). Animate width 300ms ease-out.

**Stat pill (top bar).** Icon + bold number, no box. Streak = flame icon + `--flame-text`; XP = bolt icon + `--sun-ledge` number on a level badge.

**Bottom tab bar (phones).** Fixed, white, 2px top border, `padding-bottom: env(safe-area-inset-bottom)`. 4 tabs + a raised center Add button (56px circle, leaf-button face with ledge). Each tab ≥56px tall, icon 26px above a 11px uppercase label. Active tab: icon and label `--sky-text`, a `--sky-tint` rounded background with 2px `--sky-line` border.

**Left rail (≥900px).** The same tabs stacked vertically with labels, plus a full-width primary "Add item" button. Content column max 1040px.

**Bottom sheet.** `<dialog>` pinned to the bottom on phones, full width, radius 24px on top, a 40×5px grab handle, slides up 200ms ease-out, max-height 92dvh with internal scroll. From 600px up it becomes a centered 520px card.

**Feedback banner (toast).** Slides up above the tab bar. Success: `--leaf-tint` background, `--leaf-text` bold label, mascot or check icon, optional XP chip. Error: `--berry-tint` / `--berry-text`. Undo is a text button in the banner. Auto-hide after 5s.

**Empty state.** Mascot (96px) + one short headline (800) + one line of help + one chunky button. Never a bare "No results".

## 4. Motion

- Press: 100ms. Sheets and banners: 200ms `ease-out` slide. Progress: 300ms `ease-out`.
- Rewards ("+15 XP", level-up) pop with `cubic-bezier(.34,1.56,.64,1)` over 300ms.
- Everything respects `@media (prefers-reduced-motion: reduce)` — switch to instant changes.

## 5. Game loop (closet edition)

- **XP** (derived from the closet, not stored): 10 per piece, +5 with a photo, +5 with brand and colour filled in, +5 when marked Available (confirmed).
- **Level**: every 100 XP. Show "Level N" badge and an XP bar to the next level.
- **Streak**: consecutive days with at least one piece added or updated. Flame in the top bar; at 0 show a grey flame and an inviting nudge, not a warning.
- **Daily quest**: "Add 3 pieces with photos today" with a progress bar; a celebration banner when completed.
- **Celebrate** every save with a feedback banner showing the XP gained; a level-up gets its own banner.
- Later phases add wear logging; "log today's outfit" becomes the main daily habit.

## 6. Copy voice

Short, second person, upbeat, plain words. Buttons are verbs ("Add piece", "Save", "Undo"). Celebrate specifics ("Nice! Linen shirt is in your closet. +20 XP"). No exclamation spam — one per message max. No guilt ("You haven't…") — invite instead ("Add a piece to start a streak").

## 7. Checklist before shipping a screen

- [ ] Works at 360px wide with no horizontal scroll; tab bar never covers content (bottom padding = tab height + safe area)
- [ ] Every target ≥44×44px; inputs 16px font
- [ ] Uses tokens; no white text on bright fills; small coloured text uses `*-text` tokens
- [ ] Pressables have the ledge + press drop; focus-visible ring (3px `--sky-line`)
- [ ] Empty state has mascot + action; success shows a feedback banner
- [ ] Reduced-motion respected; `100dvh` instead of `100vh`
