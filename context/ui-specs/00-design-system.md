# 00 — Design System (Shared Guideline, Apple-Design Applied)

> Applies to all HealthCentria pages. Stack: React 18 + Vite + TanStack Router + Tailwind 4 + shadcn/radix + lucide + Motion + visx. Theme confirmed: clean modern healthcare, PulseCare-style visual language only (no brand copy) — soft gradients, cards + soft shadows, blue/teal/green, English-only, light mode v1.

## 1. Apple-design translation for a barangay clinic

Full Apple fluidity (springs everywhere, gesture sheets) is powerful but must be **restrained** here: users include elderly patients on phones and busy front-desk staff on desktop. Rule:

- **Response > delight.** Pointer-down highlight (100ms), continuous 1:1 tracking on drawers/calendars, never block input during transitions.
- **Springs, but critically damped by default.** `damping 1.0, response 0.3–0.4` (Motion `type:'spring', bounce:0, duration:0.35`). Bounce (`damping ~0.8`) only for flick-driven sheets (mobile service detail, notification drawer).
- **Interruptible always.** Sheets/dialogs animate from live presentation value, can be grabbed mid-flight and reversed. No CSS-only open/close locks.
- **Reduced-motion respected.** `prefers-reduced-motion: reduce` → cross-fade 200ms, no slide/spring/parallax. `prefers-reduced-transparency` → solid toolbar. `prefers-contrast: more` → solid + border.

## 2. Layout shells

### Options considered
- **A. Sidebar + translucent topbar (recommended).** Left sidebar ≥1024px (collapsible to rail), drawer <1024px. Topbar `backdrop-filter: blur(20px) saturate(180%)` + `rgba(255,255,255,0.7)` so content scrolls under. Sidebar heavier material (white/soft gradient + shadow) to encode hierarchy.
- **B. Topbar-only.** Simpler code, but fails with 8–12 nav items; staff lose pending-badge visibility.
- **C. Bottom-tabs everywhere.** Good for patients on phones, bad for staff desktop density.

**Tradeoff:** A costs more responsive work but serves both desktop front-desk and mobile patients. Chosen: **A for all authed, with patient mobile getting large-target list + hamburger; staff mobile uses drawer, not separate UI.**

Sidebar contents: logo/name, role badge, today's service highlight ("Tue: Prenatal Day"), nav with count badge on Appointments. Topbar: page title, search (staff), bell with dot, avatar menu. Public header: minimal, solid on scroll.

## 3. Visual tokens

- **Colors:** `#E3F2FD` mist as the dominant page surface (app wash, landing wash, quiet cards), cards white with `shadow-soft (0 8px 30px rgba(15,60,90,0.08))`, accent green for confirmed/success, amber pending, red declined. Text slate-900/600. Never flat gray on translucency — use higher weight + contrast (vibrancy rule).
- **Brand palette (single source, colorhunt blues):** mist `#E3F2FD` → sky `#90CAF9` → bright `#2196F3` → deep `#0D47A1`, exposed as `--palette-mist/sky/bright/deep`. Every `--brand-*` role resolves to one of these four stops (deep doubles as ink and hover, sky as secondary/chip fill, mist as wash, bright as primary action); no derived shades.
- **Radius:** cards 16–20px, chips 999px, inputs 12px. Larger surfaces get thicker shadow + stronger blur.
- **Typography (system-ui first):** display `clamp(2rem,5vw,3rem), lh 1.05, ls -0.02em`; H2 20–24px tight; body 16px/1.5 ls 0; small 13–14px ls +0.01em. Hierarchy via weight+size+leading, not size alone. Spacing in rem so Dynamic Type scales.
- **Elevation:** small chips light shadow; sheets/modals heavier + dim scrim (modal task) vs translucent offset without scrim (parallel panel). Stacked sheets progressively dim parent.

## 4. Components (shadcn/radix base)

Button (pointer-down scale 0.97), Card, Dialog/Sheet (spring, anchored origin from trigger, symmetric enter/exit path), Input/Select/Calendar, Table, Badge/chip, Tabs, Toast (status/completion/warning/error), Avatar/Dropdown, EmptyState, Skeleton, Confirm dialog (only destructive/irreversible — cancel appointment, deactivate staff, decline with reason).

## 5. Motion spec (house style)

```js
// default
animate(el,{y:0},{type:'spring',bounce:0,duration:0.35})
// flick-driven sheet only
animate(el,{y:target},{type:'spring',bounce:0.2,duration:0.35})
```
- Animate `transform/opacity` only, `will-change` where imminent, rAF clock.
- Tap: highlight on down, commit on up, ~10px hysteresis, cancel-by-drag-away allowed.
- Drag: 10px threshold before direction lock, Pointer Events + capture, respect grab offset, track velocity history for handoff: `velocity` passed to spring; projection `current + (v/1000)*d/(1-d), d=0.998` for snap points (carousels, day strips).
- Rubber-band overscroll, not hard stop.
- Scroll edge: blur/gradient mask where content meets floating chrome, not hard 1px divider (except high-contrast mode).

## 6. Forms & feedback

Inline validation (mirror Zod), validate on blur + submit, `role=alert` errors, labels on all inputs, 44px min targets on patient flows. Feedback four kinds: status (pending chip pulse, no loop), completion (toast + bell), warning (invalid date hint), error (inline + toast). No double-tap delays except where double-tap exists.

## 7. Responsive

- ≥1024px: sidebar full; 768–1023: rail + drawer; <768: drawer + stacked cards, tables → card lists, 16px base, thumb actions bottom.
- Print stylesheet for reports only (hide nav/chrome).
- Wayfinding on every screen: Where am I? Where can I go? How do I get out? Never trap (Esc closes, backdrop click cancels but keeps draft).

## 8. What NOT to do (Purpose principle)

No dark mode, no i18n, no file uploads, no PDF, no SMS, no custom permissions editor, no slot engine, no holiday calendar v1. Every added element must earn its place.
