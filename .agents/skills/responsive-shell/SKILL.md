---
name: responsive-shell
description: The Douyin Clone user app's responsive application shell — the compact left rail, the shared width tokens in globals.css, the 1024px reflow point, and how the post-detail panel, the message workspace, the vertical feed surfaces and the profile grid reflow with it. Use when changing app-header, left-navigation, main/main-page, creator-theme-layout, the post-detail split, or any narrow-viewport layout in user/.
---

# Responsive App Shell

`user/` is a **desktop web application that adapts to a narrow viewport**. It is
not a mobile app with a bottom bar, and the reference it follows (Douyin at
`440 x 956`) is not one either. Below 1024px the labelled 160px navigation
becomes a 48px icon rail beside the content, and everything else reflows around
that one number.

## One reflow point, six tokens

All of it is driven from `user/src/app/globals.css`:

| Token | Compact (`< 1024px`) | Desktop (`>= 1024px`) | Read by |
|---|---|---|---|
| `--app-shell-nav-width` | `48px` | `160px` | the rail, its spacer, `AppHeader`, `MainPageSession` |
| `--app-header-height` | `2rem` | `3.5rem` | the bar, and every surface that clears it |
| `--post-detail-panel-ratio` | `0.38` | `0.285714` | `PostVideoStage`, `GraphicPostDetail` |
| `--post-detail-rail-gutter` | `4.5rem` | `6rem` | the photo layout's media area |
| `--post-detail-message-inset` | `0.75rem` | `1.5rem` | the post-detail message action |
| `--feed-nav-gutter` | `0px` | `68px` | For You, Following, Friends |
| `--app-viewport-height` | `100dvh` | `100dvh` | the shell, the rail, the message workspace |

**Tokens, not repeated breakpoint variants.** The consumers are `calc()`
expressions in four different components, and `max-lg:w-[calc(100%-48px)]
lg:w-[calc(100%-160px)]` at every call site is the same fact written twice in
each of them. That is exactly how the content column and the fixed rail came to
disagree between 1024px and 1280px: the column subtracted 160px only from `xl`
up, while the rail was already drawn from `lg`, so for 256px of viewport range
the navigation sat on top of the page with nothing reserving a column for it.

**Every compact value is measured off the Douyin references, not chosen.** The
supplied captures are 423px wide for a 440px viewport, so an image pixel is
440/423 = 1.040 CSS px. The first responsive pass used round numbers picked to
fit content comfortably — a 56px rail, a 56px header, a 50/50 detail split, a
52px nav gutter — and every one of them was visibly larger than the reference
while passing 83 automated checks, because those checks only asked whether the
layout fitted and whether it errored. Re-measure before changing one.

`--app-viewport-height` is `100dvh`, not `100vh`. With `100vh` a mobile
browser's collapsing URL bar leaves the bottom of the rail and the last row of
an internally scrolling panel under the browser chrome, unreachable.

## Rules

- **The rail is rendered at every width.** It used to be `max-lg:hidden`, which
  left a phone with the content column, the header and *no navigation at all* —
  plus 84px of bottom padding reserving room for a bottom bar this app has never
  had. Both shells (`main.tsx` and `creator-theme-layout.tsx`) render it now,
  because both feed `AppHeader` and `MainPageSession`, which both subtract the
  token unconditionally.
- **Every destination stays in the rail.** "Topick" was filtered out below
  1024px while there was nowhere to put it; with the rail present that just
  removed the home feed from the navigation on a phone.
- **The compact arrangement is CSS, never a JavaScript breakpoint.**
  `NavigationMenuItem` takes `variant="rail"` and expresses the icon-over-caption
  column as `max-lg:flex-col` / `lg:flex-row`. A `useIsMobile()` here would
  render the desktop shape on the server and snap after hydration. The default
  `variant="row"` is untouched, so nothing that was not opted in changed.
- **Captions may be hidden; controls may not.** The header's action captions
  ("Notification", "Message", "Upload") are `max-lg:hidden` because
  "Notification" alone is wider than the button it labels — but the accessible
  name moves to `aria-label`/`title` on the trigger, and no action is removed.
  The three promotional links fold into a "More" menu rendered from the same
  `PROMO_ACTIONS` array, one level deeper rather than gone.
- **A strip that cannot fit scrolls; it never wraps and never clips.** The Home
  category bar, the profile tab strip, the profile filter chips and the
  post-detail tab strip are all horizontal scrollers below `lg`, with
  `[scrollbar-width:none]` and `[&::-webkit-scrollbar]:hidden`. Each one scrolls
  its **active** item into view on mount and on change (`data-profile-tab` /
  `data-panel-tab` markers), because the selection often arrives from somewhere
  else — a `?tab=liked` deep link, the account menu, a notification. Give the
  active item `scroll-mr` so it does not land under a pinned close button.
- **Percentage-width fake grids do not respond.** The profile tile was
  `inline-block w-[calc(16.66%-13.34px)] mr-4 nth-[6n]:mr-0` — six columns,
  hardcoded into the tile. `grid-cols-6 gap-4` produces the identical width
  (`(100% - 5x16px)/6`), so converting the `<ul>` to a real grid was pixel-neutral
  on desktop and made `grid-cols-3` on a compact viewport one class.
- **Watch for an unconditional `min-w-*` on a page wrapper.** `min-w-170.5`
  (682px) on the profile content was the app's only source of document-level
  horizontal scrolling at 440px. It is `lg:min-w-170.5` now.
- **Never fake it with `transform: scale()` or a viewport meta hack.** Every
  change here is a real layout rule.

## The post-detail split

`POST_VIDEO_PANEL_RATIO` is `var(--post-detail-panel-ratio, 0.285714)` and
`POST_VIDEO_PLAYER_RATIO` is `` `(1 - ${POST_VIDEO_PANEL_RATIO})` `` — written
that way so the two can never be tuned apart into a gap or an overlap. The
desktop 2/7 leaves the panel **110px** at a 440px viewport, which is narrower
than one creator-grid tile and too narrow for the tab strip to exist; a compact
viewport gives the panel 0.38 instead — the reference's split, where the media
side is the wider one.

Both layouts must use the same split. `GraphicPostDetail` had `28.5714%`
hardcoded in its inline style, so a photo and a video would have divided the
same stage differently.

## Following divides four columns, not three

Every other feed is `[primary rail] [media] [panel]`. Following puts a creator
rail *in front of* the stage, so it is
`[primary rail] [creator rail] [media strip] [detail panel]` — and the panel
ratio, which is a share of the **stage section** (what is left after the creator
rail), silently becomes a share of a much smaller number.

Measured at 440x956 before this was noticed: creator rail **128px**, panel
**100.3px**. The shared five-tab strip was driven down to **6px** and still ran
`DetailsVideosCommentsR` together with a **0px** gap, with `Related` and `Ask AI`
clipped off the end. The tabs were not the problem — they were compensating for
a panel less than half the width it should have had.

`douyin-following-comments-reference.png` gives the proportions: of ~467px of app
width, primary rail ~37, creator rail ~93, media strip ~111, comments panel
~226. **The panel is 52% of everything after the primary rail.**

### The two rules

```css
@media (max-width: 599px) {
  [data-feed-surface='following'][data-creator-rail='expanded']  { --post-detail-panel-ratio: 0.678; }
  [data-feed-surface='following'][data-creator-rail='collapsed'] { --post-detail-panel-ratio: 0.566; }
}
```

- **Two ratios, one panel width.** They are solved so the panel is ~206px in
  *both* states: `0.678 x (440-48-88) = 206` and `0.566 x (440-48-28) = 206`.
  Collapsing the rail gives its 60px to the **media strip**, never to the panel.
  The panel is the column with a floor — a five-tab strip and a comment thread;
  the media strip is the one that benefits from more room.
- **Set on the stage `section`, not on `html`.** Custom properties inherit from
  the nearest ancestor that sets them, so this also wins over
  `html[data-message-open='true']` without having to out-specify it.
- **The band stops at 599px, not at the 1023px compact breakpoint.** The creator
  rail is a fixed 88px, so it is a large share of a phone and a small share of a
  tablet: at 768px the same 0.678 gave the panel **428px**, over half the
  viewport for a reading column, where the accepted 0.38 is already right.
- **The rail's expanded state lives in `FollowingFeed`,** not inside the rail.
  It decides the allocation for the whole row, and a boolean inside the rail is
  invisible to its sibling.

### The expanded rail is 88px, and everything in it is sized for 88px

It was 128px *and* every element still carried desktop type — a `text-sm` "List"
button, a `text-[13px]` sort label with `max-w-25`, a 32px More button reserved
by `opacity-0` — so the header row overflowed and was clipped by the media
column beside it. Compact now means 9-10px labels, a 20px avatar, a 20px More
button floated over the row's right edge instead of taking width from the name,
and the sort control reduced to its icon (its value stays in the `aria-label`;
a caption may be hidden, a control may not).

### A narrow player draws less, it does not draw smaller

`PostVideoStage`'s player card is `@container/playerstage`. At 98px the caption
reserves 58px for the action rail and had **40px** left, so
`@Tomas Berg · Sep 3` wrapped over four lines straight through the like and
comment icons, and the transport timecode collided with the mute button. Below
`9rem` of player the caption and the timecode are **hidden**, not shrunk — the
same words are one tap away under Details, which is open beside it, and the seek
bar already shows position. A viewport breakpoint cannot tell this case apart
from the full-width stage at the same viewport; a container query can.

## The Creator Profile At A Compact Width

Measured at 440x956 against a production build, before and after
(`browser-verify/39-profile-states.js`, 53 checks across six states and five
breakpoints). What that pass established, beyond the specific numbers:

- **A cap written against the viewport is not a cap against the column.** The
  account menu was `max-w-[calc(100vw-16px)]`, which at 440px let a 334px panel
  start at x=8 — on top of the 48px rail. It reads against
  `--app-shell-nav-width` instead, so the panel can never start left of the
  rail at any viewport. Anything that positions itself near an edge has to
  subtract the rail the same way the content column does.
- **"Anchored upper-right" is a claim about the right and top edges.** An early
  assertion tested `x > viewport/3` and failed a 304px panel in a 440px
  viewport for being exactly the compact width that was asked for. Measure the
  edge the design names, not a proxy for it.
- **A row with no `max-lg:` treatment is not "inheriting the desktop
  arrangement", it is broken.** The batch-management toolbar was `gap-4` at
  13px in ~380px of column: Select all, the count, Delete and Permission
  settings each wrapped to two lines and the search control was pushed off the
  right edge. Compact sizing plus `whitespace-nowrap`, `shrink-0` on each
  control, and `overflow-x-auto` on the row took it to one 28px line with
  nothing past the edge and zero overlapping boxes.
- **When a row is genuinely over-subscribed, drop the least urgent caption —
  never the count and never the destructive action's word.** "Permission
  settings" keeps its icon and becomes "Permissions"; the search caption hides
  in batch mode only, keeping its icon and an `aria-label`. Whoever is deleting
  things keeps every word they are reading.
- **A scroller clips at its own edge, so it needs to say so.** The tab strip
  scrolled correctly and still rendered "Collection" as "Colle", which reads as
  a truncation bug. A compact-only right-edge `mask-image` fade turns the same
  clip into an affordance. Do not solve this by renaming or hiding tabs.
- **Two gap values at three columns read as a misalignment.** `gap-x-2.5
  gap-y-3` was 10px across and 12px down; `gap-2.5` is the same tile width with
  one rhythm.
- **The type floor is a floor, including badges.** The profile grid's only
  sub-10px text was the "Pinned on top" badge at 9px. The post-detail creator
  grid still overrides it to 6px with `!` because its tiles are a third of the
  width — an override is fine, an accidental exception is not.
- **Give measurement a hook, not a class.** `data-app-nav-rail`,
  `data-account-menu`, `data-batch-toolbar`, `data-batch-checkbox`,
  `data-profile-tab-strip`. Matching on `aside`/`nav` found nothing (the rail
  is a positioned `div`) and matching on an `aria-label` that holds the
  person's display name is not a selector at all.
- **A hover-opened panel never takes focus, so a React `onKeyDown` on its
  wrapper never fires.** `Dropdown` ignored Escape entirely for
  `triggerMode="hover"` — an outside click closed the account menu and Escape
  did not. The listener is on the document now.
  Cover: `src/components/ui/dropdown-escape.spec.tsx`.

## A Compact Hero Is A Row. `flex-col` Is The Defect.

The creator profile stacked its avatar and its identity block below `lg`
(`max-lg:flex-col`), so the name, the counters and the metadata each became a
full-width row *under* the avatar and the hero grew far taller than the
reference. One class caused it and one class fixes it — but only because the
actions column is already `w-full` at that breakpoint:

- `max-lg:flex-wrap` keeps avatar and identity on row one (both auto-width) and
  lets the `w-full` actions column wrap onto its own line by itself. No DOM
  restructure, no absolute positioning, no second layout to keep in step.
- The identity block needs `min-w-0` or its text cannot shrink and the hero
  overflows instead of truncating.
- A name capped with `max-w-[calc(100vw-7rem)]` is measuring from the viewport's
  left edge as though the name started there. Beside an avatar it does not —
  cap it against its own block (`max-w-full`) and let `min-w-0` do the work.
- Measured at 440x956: `identity.left 124 > avatar.right 116`, identity top and
  avatar top both 68, hero height 130px, and the grid's first row moved from
  y=348 to y=275.

## A Strip That Must Fit Is Not A Strip That Scrolls

The same tab strip had been made a horizontal scroller. That is the right answer
when the design intends scrolling and the wrong one here: the reference shows
every tab at once, so the strip is `overflow-hidden` and the tabs share the
width.

**How the width is shared is the whole design**, and two obvious answers are
both wrong:

| approach | result at 440px, 7 English tabs |
|---|---|
| `flex-1` on every tab | equal 44px each — *every* label truncates to ~3 characters, including "Works" |
| content basis + `shrink` | flex shrink is weighted by basis, so all end at the same *fraction* (43%) — "I like it" collapses to 16px |
| **`shrink-0` on the active tab, `flex-1 basis-0` on the rest** | active label always whole; the others share what is left evenly (~35px) |

The last is what shipped. Rules that follow:

- **The label a reader needs is the selected one.** Protect it and let the rest
  ellipsize.
- **The visual label may be clipped; the accessible name may not.** Every tab
  carries `aria-label` (label + count + `(locked)`) and `title`.
- **Anything sharing the row is part of the width budget.** "Batch management"
  is ~108px at 10px and "Manage" is ~42px — the difference between the strip
  fitting and not. It uses the project's compact short-label treatment with the
  full name in `aria-label`/`title`.
- **A decorative glyph inside a squeezed tab costs a character.** The padlock is
  dropped below `lg` and its meaning moves into the accessible name.
- **Do not paper over a scroller with a fade.** A fade was added when the strip
  still scrolled; once the requirement became "it fits", the fade was a lie and
  was removed.

## Hiding A Compact Control Means `display: none`, And You Prove It

Both the Profile search and the player's Picture-in-Picture control are removed
below `lg` with `max-lg:hidden`. That is deliberate rather than conditional
rendering: these surfaces are server-rendered, and a `useIsMobile()` gate would
paint the desktop control and snap it away after hydration.

`display: none` is a genuine removal — not painted, no box, not hit-testable,
not focusable, not in the tab order, not in the accessibility tree — but that is
a claim to *measure*, not to assume. `browser-verify/40-player-transport-controls.js`
walks the real tab order, calls `.focus()` and hit-tests the control's own
coordinates at 390/440/768, and checks it is still reachable at 1440.

Two things that follow:

- **When a hidden control leaves a row with nothing in it, drop the row.** The
  liked tab passes no filters, so hiding its search left an empty 28px band; the
  row is not rendered at all in that case.
- **A hidden control still has a box in your measurements.** An audit that
  averaged the transport glyphs to compare the mute icon against them included
  the now-hidden PiP at `0x0` and pulled the mean from 10.7 to 8.0, failing a
  passing control. Filter to painted elements before averaging.

## An Icon's Size Is Its Ink, Not Its Font Size

Every transport glyph in the player is `1em` on a 32x32 viewBox, so `font-size`
and the `<svg>` box agree across all of them while the artwork inside does not.
The mute control looked oversized because `VideoVolumeControl` lives in its own
file and never received the `max-lg:` size its siblings carry — measured at
440x956: 18x16.1 CSS pixels of ink against a 11.2x10.7 average.

- **Measure `getBBox()`**, scaled by the viewBox ratio. It is the only number
  that catches this.
- **Resize the glyph, not the button.** The mute button keeps `h-8 w-8` at every
  width — larger than its 24x24 neighbours — so aligning the artwork does not
  shrink a touch target.
- **A control extracted into its own component is the one that misses the next
  responsive pass.** When adding a `max-lg:` variant to a row, grep for the row's
  other members in other files.

## Verifying

`user/browser-verify/24-following-columns.js` is the Following column pass: it
signs in, measures the four columns in all four rail/panel combinations, and
asserts them against the reference targets. The pixel targets apply at **440
only** — the rail is a fixed width, so 440's numbers at 390 would report a
correctly-scaling layout as a defect; elsewhere it asserts the invariant (the
panel keeps one width whatever the rail does), that the columns tile with no
overlap, that the tab strip fits with a real gap, and that nothing in the rail
overflows its column.

`user/browser-verify/21-responsive-shell.js` is the acceptance pass: four
viewports (`440x956`, `390x844`, `768x1024`, `1440x900`) across Home, For You,
Following, Friends, Profile and Profile→I like it, asserting no document-level
horizontal overflow, the resolved nav-width token, the header's actual left and
right edges, and that every nav destination is present and on screen. It also
pages "I like it" to exhaustion and asserts 67 distinct tiles.

`user/src/components/layout/responsive-shell.spec.tsx` pins the contract in
Jest — jsdom has no layout engine, so it asserts that the token is the single
source rather than measuring pixels.

Screenshots go to `output/screenshots/` (repo root), per `AGENTS.md`.

**Measure, do not read the code.** `scrollWidth > clientWidth` on the root
element is the only definition of horizontal overflow that matches what a person
sees; an element wider than the viewport is fine if an ancestor clips it.
