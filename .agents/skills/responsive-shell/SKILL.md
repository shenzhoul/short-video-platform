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

## Verifying

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
