---
name: post-feed-navigation
description: One resolver decides what next/previous mean on every post surface, and one drag transform moves them. Load before touching feed navigation (wheel, trackpad, touch, arrow keys, the up/down capsule, the popup's next/previous), the creator-scoped Videos tab, or the drag-follow-finger stage on For You, Following, Friends and the post-detail popup.
---

# Post Feed Navigation

Last updated: 2026-09-07

## The problem this exists to prevent

"What does *next* mean here?" has been answered independently by six different
places, and they disagreed every time:

- the photo detail layout and the video detail layout (fixed by
  `usePostDetailSequence`);
- the For You stage, which disabled navigation whenever any panel was open —
  including the Videos tab, where the popup was happily stepping through the
  same creator grid;
- the Following stage, which had no gating at all and closed the panel on the
  way past to hide the mismatch;
- and the popup, which alone knew that typing a comment should stop the arrows.

Every one of those looked like data rather than a bug.

## One resolver

`user/src/lib/post-navigation-context.ts` is the only definition:

```ts
resolveNavigationContext({ panelTab, source, inputActive, messagesOpen })
  : 'recommendation' | 'creator' | 'disabled'
```

| condition (in precedence order) | context |
|---|---|
| `inputActive` — a text field focused, or a pointer held on a seek bar or scroller | `disabled` |
| `messagesOpen` | `disabled` |
| a creator-scoped `source` (`profile-videos`, `creator-videos-tab`) **or** `panelTab === 'videos'` | `creator` |
| any other panel tab open | `disabled` |
| nothing open | `recommendation` |

- **`inputActive` outranks creator mode.** Scrubbing is a vertical-ish drag
  straight over the media and typing a reply uses the arrow keys; losing the
  post mid-gesture loses what the viewer was doing. It is computed by
  `useNavigationInputActive`, never guessed per call site, and the seek input
  carries `data-navigation-hold="true"`.
- **A creator-scoped source stays creator-scoped under any tab.** The list has
  not changed just because the viewer opened Comments.
- `usePostDetailMode` wraps the resolver and adds the one piece of state it
  needs: the creator, **captured on entering creator mode and held until it is
  left**. Reading it back from the open post is circular — see
  `.agents/rules/user.md`.
- `PostDetailMode` is an alias of `PostNavigationContext`. The old spelling
  `'locked'` is gone; it is `'disabled'`.

## One controller

`usePostDetailSequence` owns the list. Every surface calls it — the popup, the
For You stage and the Following stage — and every input reads the two flags it
returns:

```ts
const canPrevious = Boolean(sequence.previousPost);
const canNext = sequence.canNext;
const navigate = sequence.navigate;   // wheel, drag, arrow keys, the capsule
```

**A creator-mode neighbour is usually not in the feed.** An inline stage
therefore keeps a `creatorStagePost` beside its `currentIndex`:

```ts
const activePost = creatorStagePost || posts[currentIndex];
```

A neighbour that *is* in the feed moves the index — so impressions, watch
tracking and prefetch keep following it — and one that is not is held
separately, leaving the feed position intact underneath so closing the grid
resumes the browse instead of restarting it.

## The drag transform

`usePostDragNavigation` + `PostFeedDragViewport`. Three slides, one signed
number:

| slide | `translate3d(0, …, 0)` | at rest |
|---|---|---|
| current | `dragDeltaY` | `0` |
| next | `itemHeight + dragDeltaY` | one below |
| previous | `-itemHeight + dragDeltaY` | one above |

- **`translate3d`, never `top`.** Composited, so the gesture never re-lays-out
  the stage.
- **No transition while the finger is down.** Any easing puts the slide
  somewhere other than where the finger is.
- **Commit 240ms, rollback 200ms.** The commit finishes the journey (a full
  `itemHeight`), then resets the delta and navigates **in the same commit** —
  two commits show one frame of the new post at the old offset.
- **Both neighbours stay mounted.** Mounting on `pointerdown` was measured
  showing a bare blur placeholder for the first third of every drag: the cover
  had no time to fetch. Clipping — `overflow: hidden` on the viewport — not
  unmounting, is what keeps them out of sight.
- **The neighbour is a still, not a stage.** A real stage would decode a second
  video and fire an impression for a post nobody chose. It draws the cover, in
  the same card (`--post-video-player-width`, `rounded-2xl`), so the framing
  does not jump when the commit swaps it for the player.
- **`prefers-reduced-motion` removes the unattended animation, not the
  gesture.** Following the finger is direct manipulation; the 240ms glide and
  the spring-back become instant.
- **Past the end the stage resists** (damped by `OVERSCROLL_DAMPING`) and never
  commits. The resistance *is* the message that there is nothing beyond.
- **`itemHeight === 0` disables the gesture.** A threshold computed from zero
  fires on the first pixel. `useElementHeight` waits for the element across
  frames, because these surfaces render a loading branch first and the ref is
  still null on the effect that measures it — a plain `if (!ref.current) return`
  measured nothing, never ran again, and silently disabled the whole drag with
  no error anywhere.

## The Top-Left Control Reads The Mode, And Its Memory Lives Above The Swap

The popup's top-left button is Close, or Back out of the Videos tab. Both
layouts render one component — `PostDetailBackButton` — driven by one hook,
`usePostDetailBackControl`, whose only input for that decision is
`mode === 'creator'`.

It was written inside `VideoPostDetail`. `GraphicPostDetail` drew its own
button — always an X wired straight to `onClose` — so an **image** post with the
creator grid on screen still said Close, and pressing it threw the viewer out of
the popup instead of returning them to the post they came from.

- **Never `post.type`, never "is a `<video>` mounted", never a callback only the
  video stage can fire.** Any of those makes the control differ between a photo
  and a video, and makes it *change under the viewer* when a creator's grid
  steps them across a media-type boundary.
- **Escape is the same action as the button** (`backControl.activate()`), so the
  first press leaves Videos and a second closes. Two code paths for one decision
  is how they drift.
- **The accessible name changes with the meaning** — `Exit creator videos` /
  `Close post details` — and `data-detail-back` exposes it for verification
  without reading an icon.

### The memory is the part that has to live above the layouts

Back returns to the post creator mode was *entered on*, not to whichever of the
creator's posts is open. That origin is a `useRef`, and holding it inside a
layout is wrong for the same reason the panel tab was: crossing a media-type
boundary unmounts the layout, the ref is re-seeded with the creator post just
opened, and — because creator mode is already active, so the "not in creator
mode" guard never fires — it stays wrong. `usePostDetailBackOrigin` is therefore
called in `PostDetailModal` and passed down as `originPost`.

**The failure was invisible to the obvious test.** Measured in a real browser:

| transition | layout swap | Back restored the base |
|---|---|---|
| video base -> video creator post | no | yes |
| video base -> photo creator post | **yes** | **no** |
| graphic base -> video creator post | **yes** | **no** |

The one passing row is the one where nothing unmounted. A matrix that exercises
only same-media navigation cannot see this — which is precisely why the media
type must never be what decides the behaviour, *and* why the regression matrix
has to cross the boundary in both directions.

### A missing pairing is not a failing test

`image base -> image creator post` cannot be exercised against the demo
catalogue at all: all 16 creators hold exactly one photo and nine videos (16
photos / 144 videos), so no creator grid can offer a *second* photo to step
onto. `browser-verify/37-detail-back-control.js` reports that as
`NOT EXERCISABLE`, with the count kept separate from passes and failures, rather
than passing silently or reporting a defect the code cannot cause. The case is
covered at the hook level instead.

## Cover

- `src/lib/post-navigation-context.spec.ts` — the full matrix, 25 cases.
- `src/hooks/use-navigation-input-active.spec.tsx` — 8 cases, both directions.
- `src/hooks/use-post-drag-navigation.spec.tsx` — 18 cases.
- `src/components/content/post/post-feed-drag-viewport.spec.tsx` — 14 cases.
- `src/components/content/post/for-you-navigation-modes.spec.ts` — the wiring.
- `browser-verify/23-navigation-and-drag.js` — real CDP touch events against a
  production build; 21 checks at 440/390/768/1440.
- `src/components/content/post/detail-back-control.spec.tsx` — the four
  transitions, the origin memory, and source-level assertions that both layouts
  render the shared button and that the modal (not a layout) owns the origin.
- `browser-verify/37-detail-back-control.js` — the same matrix in a real
  browser, plus Escape ordering and the P0/P1 history round trip with an image.
