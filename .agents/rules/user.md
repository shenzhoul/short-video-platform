# Web Front Rules

These rules apply to `user/`.

## Structure And Naming

- Use lowercase kebab-case for filenames, except for framework-reserved files such as `page.tsx` and `layout.tsx`.
- Use clear, friendly names for components, functions, variables, and props.
- Split UI into smaller related components instead of building large page files with mixed responsibilities.
- Keep API request logic in `src/services/`. Do not scatter direct fetching logic across UI components unless there is a very good reason.

## Rendering Strategy

- Public pages that matter for SEO, such as listing pages and detail pages, should default to server-rendered output in Next.js.
- Private or highly interactive pages can use client-side rendering when that makes the implementation simpler and the SEO cost does not matter.
- Be explicit about the rendering choice for each page instead of mixing patterns accidentally.

## Metadata And SEO

- Every route should resolve to a clear page title through Next.js metadata APIs, even when the page is private or not intended for SEO.
- Public pages should add SEO metadata intentionally: title, description, canonical URL, robots, and social sharing metadata when the page is meant to be indexed or shared.
- Private, auth-only, dashboard, payment-status, and similar utility routes should normally keep `robots` set to `noindex`.
- When public metadata depends on server-fetched content or settings, use the SSR helper pattern and keep metadata based on public-safe data only.
- Use `export const metadata` for static cases and `generateMetadata()` for dynamic cases; do not mix both in the same route segment.

## React Patterns

- Use React hooks correctly and idiomatically. Respect the rules of hooks (top-level only, stable order).
- Reach for the right hook for the job: `useMemo`/`useCallback` to keep referential identity stable and stop needless re-renders, `useEffect` only for real side effects (not for derived state), custom hooks to extract and reuse stateful logic.
- Keep data-fetching and stateful logic in hooks/services, not inlined across JSX.
- Split a component that grows too big into smaller components and extract logic into custom hooks.

## Styling

- This app uses Tailwind CSS.
- Follow Tailwind-first styling patterns and keep utility usage consistent with the existing codebase.
- Prefer composition and small components over large class-heavy files.
- Use `src/components/ui/dropdown-menu.tsx` for dropdown behavior. Its shared menu motion is defined once in `globals.css`; feature dropdowns may style their menu but must not add private open animations. Tailwind 4 positioning utilities use the CSS `translate` property, so shared dropdown keyframes must animate `transform: translateY(...)` and never overwrite `translate`.
- Use the root `ToastContainer` and `react-toastify` for user feedback.
- Theme tokens must match the surface they land on. `--surface-*` / `--text-*` /
  `--border-*` flip with `data-theme`; the Post Detail panel is dark in **both**
  themes, so a card inside it painted with page tokens turns near-white in light
  mode behind text that stays white. Use the `--overlay-*` tokens there. Check a
  new surface in both themes before assuming a token is safe — and measure with
  the browser's own colour resolution: computed values are `oklab()`, so parsing
  their components as RGB reports a readable card as unreadable.
- Scrollbars are styled once, globally, in `globals.css` — thin, transparent track, thumb from
  `--scrollbar-thumb`. Do not add a per-surface scrollbar class: a container that forgets it gets
  the browser default, and the mismatch shows the moment two scroll areas sit side by side. Tailwind
  has no `scrollbar-*` utilities here (no plugin installed), so `scrollbar-thin` and
  `scrollbar-none` are inert; to opt out of the global bar use `[scrollbar-width:none]` together
  with `[&::-webkit-scrollbar]:hidden`.
- For any new design or UI/UX change, follow `.agents/skills/taste-skill/SKILL.md` (and `.agents/skills/redesign-skill/SKILL.md` when polishing an existing page). Do not ship generic/templated UI.

## Post Detail: One Sequence, Owned Above The Layouts

The detail modal draws a photo and a video with **different components**
(`GraphicPostDetail` / `VideoPostDetail`). Anything either of them decides for
itself will eventually differ from the other, and anything either of them holds
in state is destroyed the moment the viewer moves to a post of the other kind.
Both have caused real defects:

- **Divergent decisions.** The video layout switched next/previous to the
  creator's own posts whenever the creator grid was open; the photo layout
  fetched the creator's posts to *draw* that grid and then navigated the feed
  behind the modal. Opening a photo from the home feed and pressing next jumped
  to another creator while their grid was still on screen. Fixed by giving the
  sequence one owner, `useCreatorVideos` + `usePostDetailSequence`, that both
  layouts call.
- **State lost on the swap.** Which panel tab is open was held inside each
  layout, so stepping from a photo to a video unmounted the component and closed
  the creator grid — and closing the grid dropped the creator scope the sequence
  depends on, so the *next* step fell back to the feed. Fixed by lifting the tab
  into `PostDetailModal`, above the swap.

Both recurred. Later rounds found the same class of defect twice more: the
photo layout and the video layout each re-derived "is the creator grid open"
from their own booleans, and the For You stage kept walking the recommendation
feed while a creator's grid was on screen beside it.

## A Badge That Means "In This List" Needs To Know Which List

`Pinned on top` is a statement about one creator's own ordering, not a property
of the post. It was rendered from `post.isPinned` alone, and
`CreatorProfileWorkItem` is shared between the Works tab and the "I like it"
tab — so a liked post from another creator announced that it was pinned to the
top of a list it was not even in.

- **The prop defaults to hidden.** `showPinnedBadge` is opt-in, so a new grid
  that forgets it shows no badge rather than the wrong one. Only the creator's
  own collection (the Works tab, the modal's Videos grid) asks for it.
- **Never fix this by changing the data.** The pin stays on the DTO and creator
  ordering still uses it; what changed is that the badge has to be asked for.
- Cover: `pinned-badge-context.spec.tsx`.

## Recommendation Mode Falls Back To Whatever The Surface Passed

`usePostDetailMode` is already the single owner of the mode, and it is a pure
function of the open tab — closing the Videos tab leaves creator mode on the
same render, with no ref holding the old playlist. When "the panel closed but
up/down still walks that creator" is reported, **the mode is not the thing to
audit**: what recommendation mode falls back to is `PostDetailModal`'s `posts`
prop, and each surface chooses that for itself.

| Surface | `posts` | Correct? |
|---|---|---|
| Home | `useRecommendationDetailFeed` | yes |
| For You / Following | their own feed | yes — they *are* feeds |
| creator profile | that creator's grid | yes — the profile is creator-scoped |
| **search** | the search results | **no** |

Search passed its result list, so closing the Videos tab handed navigation back
to it. Search for a creator, or a hashtag they own, and every result is their
work: the panel had closed but up/down kept walking their catalogue, which reads
exactly like never having left the tab. Search now mounts the same
recommendation detail session Home does.

A surface that opens the modal without a feed of its own should mount
`useRecommendationDetailFeed` and pass `source`, `recommendationSessionId` and
`hasMoreAhead` with it — not hand over whatever list it happens to be rendering.
Cover: `post-detail-navigation-mode.spec.tsx`.

## Post Detail: three modes, one owner

There is now an explicit mode, decided once in `PostDetailModal` by
`usePostDetailMode` and handed to both layouts:

| Panel state | Mode | Sequence owner | May change creator | Scroll moves the post |
|---|---|---|---|---|
| nothing open | `recommendation` | the recommendation session | yes | yes |
| **Videos** tab open | `creator` | that creator's posts | no | yes |
| any other tab | `locked` | nothing | n/a | no |

- **Never re-derive the mode inside a layout, and never add a second boolean
  beside it.** The arrangement it replaced — `videoModeActive`,
  `videoModeDismissed`, and each layout's own reading of `panelTab` — could have
  all three true at once, and the two layouts disagreed about what they meant.
- **The creator is captured on entering creator mode and held until it is
  left.** Reading it from the open post is circular: in creator mode the open
  post *is* one of that creator's posts, so one stale response naming somebody
  else re-points the whole sequence and the grid never comes back.
- **Enforce the invariant, do not assume it.** `usePostDetailSequence` drops any
  item whose `user._id` is not the captured creator and logs it in development.
  This is not paranoia: `/posts/home-posts` served the creator grid and silently
  stopped honouring `userId` when it became the ranked Home feed, so a request
  for one creator came back holding eight — under that creator's name, with
  next/previous walking straight out of their catalogue.
- **A late response belongs to the creator it was requested for.**
  `useCreatorVideos` stamps every request and discards a page for a creator the
  viewer has already left, and only marks a creator "loaded" once a request has
  genuinely been issued. Marking it before that, while dropping requests that
  arrive during another fetch, is what let the previous creator's page land in
  the new creator's grid and never be corrected.
- **The For You inline stage obeys the same three modes.** Its Videos tab is
  reachable from the panel's own tab strip, and before this the arrows kept
  moving the For You feed underneath it.

Rules that follow:

- **Anything that must survive moving between posts belongs in
  `PostDetailModal`**, not in either layout. That includes the open panel tab,
  the navigation mode, the captured creator, and anything derived from them.
- **The grid, the highlighted tile and the arrows read one list.** Do not sort
  in more than one place; `creator-post-order.ts` mirrors the API's
  `creatorPinnedSort` (`isPinned`, `pinnedAt`, `createdAt`, `_id`, all
  descending) and is the only definition.
- **Name the source, do not infer it.** `PostDetailSource` says which list the
  viewer came from. A post carries no record of that, and guessing from its
  shape is what produced the photo/video split in the first place.
- **A post that is open but not yet fetched is *placed* in the list, not
  appended** (`insertPostInOrder`). Appending puts it at the end of the grid
  wherever it really belongs, so the highlight and the arrows point at different
  neighbours.
- Regression cover: `use-post-detail-sequence.spec.tsx` (fails 7 of 9 against
  the old behaviour), `creator-post-order.spec.ts`, `use-post-detail-mode.spec.tsx`,
  `use-post-detail-navigation.spec.tsx`, `use-creator-videos.spec.tsx` (3 of 5
  fail against the racing version), and `use-recommendation-detail-feed.spec.tsx`
  (4 of 10 fail against the version whose refill a re-render could cancel).
  Browser: `user/browser-verify/13-regression-acceptance.js`.

## A Full-Bleed Stage Draws What The Post Holds

`PostVideoStage` is the stage for *both* media kinds. It mounts the player only
when `getPostVideo(post)` is non-empty, and draws `PostGraphicStageMedia`
otherwise.

For You rendered every recommended post through the video branch, so a photo
post mounted a `<video src="">`. React refuses to set an empty `src`, warns, and
leaves a black rectangle with transport controls where the images should be —
and the ranked feed opened on a photo post, so it was the first thing a visitor
saw. One seeded post in ten is a photo.

- **`src={url || ''}` is not a fix.** The unplayable element is the defect; the
  console warning is only how it announced itself. If there is no URL, do not
  render the element.
- **A post the stage cannot draw is skipped, with a logged reason** — never
  rendered as a blank slide, because next/previous step through the same array
  and the viewer would be stuck on it.
- **Watch tracking follows the media, not the surface.** A photo produces no
  `timeupdate`; it needs `useRecommendationPhotoDwell`, and leaving the video
  hook enabled for it yields a permanently empty signal.
- Regression cover: `post-video-stage-media.spec.tsx` (4 of 5 fail against the
  single-branch stage) and `for-you-navigation-modes.spec.ts`.

## A Listing Names Its Own Scope

A list of "somebody's posts" takes the creator id as an input. It never infers
one from the session, and it never reuses a route that answers a different
question.

- `useCreatorPostSearch({ creatorId })` pages `/posts/creator-posts` for a
  profile; **without** a `creatorId` it pages `/creator/posts` (`myPosts`), which
  is the owner's own management screen and by definition needs no id. There is no
  third behaviour. Before this the hook only ever called `myPosts`, so the profile
  grid was one line of wiring away from listing whoever happened to be signed in
  — and the grid could not page at all, printing "No more for now" under a list
  that never grew.
- Every response carries the creator it was requested for and is dropped if the
  viewer has moved on. Two profiles visited quickly must not merge.
- A cursor only means something against the list it came from. `lastIsPinned` and
  `lastPinnedAt` travel with it, and paging must never re-emit the pinned block.
- Covered by `use-creator-post-search.spec.tsx` (6 of 7 fail against the
  `myPosts`-only version) and `browser-verify/14-creator-profile-pagination.js`.

## A Guest Subject Is Issued At The Edge, Before Anything Renders

`proxy.ts` mints the recommendation-subject cookie when a request arrives
without a valid one, sets it on the **request** as well as the response, and
forwards `request.headers` through the rewrite. That ordering is the whole
point: a feed session belongs to the subject that created it, so a server render
with no subject builds a session the browser cannot continue — it asks for page
two, the server does not recognise the owner, and silently starts a *new*
session. Measured on a first-ever visit before this: two sessions for one page
load, and a Home feed of 78-86 cards against a 70-item policy.

- **The cookie is the source of truth, not `localStorage`.** If the client
  preferred its own stored value it would disagree with the render that just
  happened. `localStorage` is a fallback for when the cookie is unavailable.
- **Validate the value before using it.** It becomes a Redis key segment and a
  session owner, so it is bounded and shape-checked
  (`isValidRecommendationAnonymousId`) on the way in, at the edge *and* in the
  API payload. Anything outside the shape is replaced, not trusted.
- **Never a shared `guest` subject**, and never logged: it is a session key, and
  the numbers are what diagnostics need.
- Cover: `proxy.spec.ts` (6 of its 24 tests fail without the issuance) and
  `browser-verify/18-first-visit-session.js`.

## A `'use client'` Module Cannot Export A Constant To The Server

Next replaces a `'use client'` module with a client *reference* when a server
component imports it. A plain `export const` from such a module is not a usable
value on the server — it is `undefined`, with no error, no warning and no type
complaint.

This shipped: the guest recommendation-subject cookie name was exported from the
client module and read by a server component, so `cookies().get(undefined)` found
nothing and **every server-rendered feed page built a session the browser could
not continue**. Shared constants that both sides read live in their own module
with no directive (`src/constants/recommendation-anonymous-id.ts`). Verify such a
change by asserting the server's *observable* effect — here, the `subjectId`
stored on the Redis session after a request carrying the cookie — not by reading
the code.

## One Fallback, In One Place — The Default Avatar

`user/src/lib/avatar.ts` (`resolveAvatarUrl`) and its byte-identical twin
`admin/src/lib/avatar.ts` are the only definition of "what to show for a user
with no picture". Never write `user.avatar || '/no_avatar.jpeg'` at a call site
again.

That inline form is what this replaced, and it was wrong in three different ways
at once across the two apps: 23 files spelled it correctly, the account dropdown
drew an `AvatarIcon` glyph on a grey disc instead, and two call sites
(`share-recipient-row.tsx`, `admin`'s `user-list.tsx`/`user-selector.tsx`)
pointed at `/no-avatar.png` — a file that exists in neither `public/` directory,
so those lists rendered a broken image. Nothing errored; a fallback that is
itself missing looks exactly like a slow one.

- **It is presentation only.** Nothing writes the placeholder path anywhere: no
  Mongo field, no file-server record, no R2 object. An account with no avatar
  keeps the field absent, which is what keeps "never set one" distinguishable
  from "chose this" and keeps the unused-file sweeper from seeing a phantom.
- **Blank counts as absent.** `'   '` is truthy and is not a URL — in `src` it
  resolves against the page and silently re-requests the current document.
- **`admin` needs its own copy of the bytes.** It is a separate Next app on its
  own origin, and `public/` is served from disk at the app root, so a shared
  package would still need a build step to copy the file in. The duplication is
  deliberate and pinned: `user/src/lib/avatar.spec.ts` compares
  `user/public/no_avatar.jpeg` and `admin/public/no_avatar.jpeg` byte for byte.
  It lives in the user app's suite because `admin` has a `test` script but no
  Jest configuration.
- **A placeholder must not eat an affordance.** `admin`'s `AvatarUploader` draws
  the placeholder *and* keeps the camera/"Upload" overlay on top; replacing the
  empty state with the image alone would have removed the only cue that the tile
  is clickable, so an unset avatar would have looked final.

## Picture-In-Picture Navigates A Session, Not The DOM

`openPopupPip` takes **no playlist**. It used to take the Home grid's video posts
in rendered order, and the floating player's next/previous stepped through that
array — so "next" was whichever card happened to sit below the one playing, and
scrolling the page underneath changed what "next" meant.

The window now walks the same anchor-based Post Detail recommendation session the
detail viewer walks (`stepPostDetailRecommendationNext(..., videoOnly)`), which
is what stops there being two unrelated ideas of "another video".

- **Next** comes from the session, which excludes everything it has handed out —
  so it can never return the post that is playing, and never repeat one.
- **Previous** is `PopupPipState.history` and nothing else. It replays exactly
  what was shown and never calls the server, which is also why the server cursor
  stays at the head and the next forward step always computes something new.
- **Recycling is deterministic**: exhaustion wraps to `history[0]`, never a
  random pick from posts the viewer has just been through.
- **One session per PiP browse.** `appendPopupPipVideo` writes the session id in
  the same state write as the video; opening a second session would reset the
  exclusions and start recommending posts already in the history.
- **State that must survive a track change lives in `PopupPipState` or a ref, not
  in the render.** The mute choice is a ref (`preferredMutedRef`) because the
  load effect used to assign `video.muted = true` unconditionally, so unmuting
  was undone by the next press of "next". The transport only resets when the
  `videoId` actually changed — a write that merely records the session id must
  not send the video back to 0:00.
- Cover: `user/src/components/ui/popup-pip-navigation.spec.tsx`.

## Do Not `preventDefault` A Wheel You Are Not Consuming

React attaches `wheel` passively, so `preventDefault()` in an `onWheel` handler
suppresses nothing and logs "Unable to preventDefault inside passive event
listener invocation" on every tick. `usePostNavigationWheel` therefore returns
early when neither direction can navigate — with a reading panel open the scroll
belongs to the panel — and guards the call with `event.cancelable`.

## The End Of A Ranked Session Is Not The End Of The Feed

Home and For You page through a Redis-stored ranked session. A session is a
bounded *sample* — 70 of 160 posts on this catalogue — and that bound is what
makes a reload a new selection rather than a re-sort.

### One browse is a chain, and the client owns its identity

`@lib/browsing-chain` mints a chain id **per page load, per surface, per Home
category**, in a module variable and nowhere else. That lifetime is the whole
point:

- a **reload** re-evaluates the module and mints a new chain, so a browse can
  never inherit a spent one. `deploy-2026-09-06g` derived the chain from the
  first session id instead, and a reload after a long browse served **11 posts**
  before reporting the feed exhausted;
- **two tabs** are two module instances and never consume each other's
  catalogue;
- **a category switch** is its own browsing context, so a small category is not
  starved by what "All" already showed.

`sessionStorage` would break the first of those and `localStorage` the first and
third. Do not "improve" this by persisting it.

The first page is server-rendered, so the SSR wrapper mints the id, sends it,
and the hook adopts it (`adoptBrowsingChainId`) **during render** — a scroll can
trigger `loadMore` before that commit's effects run.

### Every post appears at most once per browse

`mergeFeedPage` de-duplicates by **real post id** across the whole accumulated
list. Not by a per-cycle key, not by anything derived: `deploy-2026-09-06h`
keyed entries `<cycle>:<id>` so a recycled chain could show the catalogue again,
and Home grew to **410 cards** of a 160-post corpus, openly repeating itself.
Chains no longer recycle; this de-duplication is what makes a stray repeat
impossible rather than merely unlikely.

### Rules that follow

- **`!hasMore` means "this session is done", not "the feed is done".** Roll
  over: send the spent `sessionId` with `rollover: 'true'`, the same `chainId`,
  and no cursor.
- **The stop condition is the server's word.** `isChainSpent` is
  `chainExhausted`, or a rollover that returned nothing at all. It is never
  inferred from the client's own de-duplication — that inference ended Home at
  89 of 160 — and never papered over by recycling, which ended it nowhere.
- **Never raise the session limit toward the pool size to "fix" a short feed.**
  That deletes the ranking rather than continuing the scroll.
- **Bound the DOM, and say so honestly.** `MAX_RENDERED_FEED_POSTS` is a guard
  for a catalogue far larger than this one; the end-of-feed copy distinguishes
  it from a genuinely finished browse.
- Cover: `use-home-feed-infinite-scroll.spec.tsx`, `browsing-chain.spec.ts`,
  `use-feed-chain-page.spec.ts`. See
  `.agents/skills/recommendation-engine/SKILL.md` for the server half.

## One Post, Many Copies — Patch Them All By Id

The app keeps **many independent copies of the same post**. Twelve hooks own an
`IPost[]` of their own (Home, For You, Following, search, liked posts, creator
grid, creator videos, the detail sequence, …) and `usePostInteractionState`
keeps a thirteenth for whichever post is open. There is one `IPost` shape and
one `PostDto` behind it, so the copies are compatible — what was missing was any
way to update more than one.

An update travelled exactly one edge: `usePostInteractionState` called the
`onInteractionChange` prop it had been handed, which patched the single list
that supplied it. Measured in production: liking a post in the detail modal's
action rail updated the modal and left the *same post's* card in the creator
"Videos" tab showing the old total, side by side on screen.

- **Publish, do not thread.** `@lib/post-interaction-bus` fans a change out to
  every mounted copy by post id. It is a fan-out, not a store: no post lives in
  it, nothing is cached, each list keeps owning its own array.
- **Every owner of an `IPost[]` subscribes.** `usePostInteractionUpdater` does
  it for you; a hook with its own `setPosts` (`useCreatorVideos`) subscribes
  explicitly. A list that does not subscribe is a stale copy waiting to be seen.
- **Patches are absolute, never deltas.** `totalLike: 42`, not `+1`. That is
  what makes receiving your own publish, or the same change from an optimistic
  update *and* the websocket snapshot, idempotent rather than a double count.
- **`isLiked` never comes from a shared snapshot.** B liking a post says nothing
  about whether C does. It comes from this viewer's own action, or their own
  fetch (`usePostViewerStateHydration`) — which is how a listing that answered
  without the viewer gets corrected. Never derive it from `totalLike`.

## A Cache And Its "Already Loaded" Mark Are One Piece Of State

`useCreatorVideos` kept the creator's posts in `useState` and the "already
loaded" mark in a `useRef`, and cleared **only the posts** when the modal
closed. Reopening the same creator then took the "keep the loaded pages" branch
over an array that had just been emptied: the grid showed exactly **one** video,
and `hasMore`/`nextCursor` still held the end-of-list values from the first
load, so it also announced "All videos loaded".

- **Key the cache by what it describes.** It is a `Map<creatorId, entry>`, never
  keyed by the open post or the modal.
- **Closing hides; it does not destroy.** Reopening restores the entry, so
  pagination stays valid across a close.
- **Store the pages, the cursor, `hasMore` and `loaded` in one object**, so they
  cannot be cleared apart from one another.
- Cover: `post-state-sync.spec.tsx`.

## Feed Rendering And Scroll Performance
## Feed Rendering And Scroll Performance
## Feed Rendering And Scroll Performance

The Home Feed keeps every card it has loaded — 160 posts is 4,176 DOM nodes —
and that is deliberate. Two attempts to bound it were measured and both were
large regressions, for the same reason: **discarding rendered state costs more
to rebuild than to keep**.

| Approach | Result on the same gesture |
|---|---|
| unmount off-screen cards (virtualisation) | 3-5x slower; media requests 160 → 800+ on one down-and-up pass, because re-entry re-creates the `<img>` and the browser decodes it again |
| `content-visibility: auto` on the card media | S6 (three down-up cycles) 5,196ms → 53,840ms of long tasks; geometry was verified identical first, so this is the re-render-on-entry cost, not layout |
| a 40-card window, best case, geometry preserved and images kept decoded | 8x slower on scroll-down (272ms → 2,203ms), p95 33ms → 450ms — the *ceiling* any windowing or page-compaction scheme could reach |

**The DOM was never the cost.** With image painting suppressed, the same
40-step scroll over all 160 cards spends **0ms** in long tasks, p95 17ms, worst
33ms. Before proposing to shrink the feed's DOM, measure that first: if painting
is the cost, a smaller DOM does not help and re-entry makes it worse.

What did matter, in order of size:

1. **Oversized images.** A cover pointing at a processed original rather than
   the generated thumbnail (26 megapixels for a 265px box). Fixing the source
   data took the worst frame from 800-1500ms to 83-183ms.
2. **Media left mounted off-screen.** A scroll usually moves the *content*, not
   the pointer, so the card that slides away never gets `mouseleave` and keeps
   its `<video>` mounted and decoding — measured at `top: -6497px`, surviving
   every later scroll and the pointer leaving the grid entirely. An
   `IntersectionObserver` in `usePostVideoHoverPlayback` now tears the preview
   down on leaving the viewport; removing those strays took every scroll
   scenario to **0ms** of long tasks. `feed-card-performance.spec.tsx` covers it.
3. **`memo` on the card.** Roughly half the cost of a hover-scroll.

Measured and **rejected**: moving the hover state into a `useSyncExternalStore`
module store so the feed does not re-render. It is worse — 86 commits and
1,473ms against 62 and 529ms on an isolated hover gesture — because the store
notifies outside React's batching, so the parent and the card commit separately
instead of together. `useState` plus `memo` is the faster arrangement.

Measure in **production builds only**. Dev-mode numbers varied by ±2.7x on the
same build and are worthless here.

## Skills To Use

Load the relevant repo skills when the task matches them:

- `.agents/skills/vercel-react-best-practices/SKILL.md`
- `.agents/skills/vercel-composition-patterns/SKILL.md`
- `.agents/skills/taste-skill/SKILL.md` — any new design or UI/UX change
- `.agents/skills/redesign-skill/SKILL.md` — audit-first polish of an existing page
- `.agents/skills/web-ssr/SKILL.md`
- `.agents/skills/web-seo/SKILL.md`
- `.agents/skills/file-service-integration/SKILL.md`
- `.agents/skills/media-response-standardization/SKILL.md`
- `.agents/skills/websocket-integration/SKILL.md`
- `.agents/skills/direct-messaging/SKILL.md` — message workspace, page reflow, container-query grids
- `.agents/skills/post-sharing/SKILL.md` — share popover, recipient list, shared-post cards

## Quality

- Run targeted `yarn test` commands for changed behavior, then `yarn lint` and `yarn build`.
- Add or update focused tests when component logic or rendering behavior is important.
- Dev and production write to separate output directories on purpose: `next dev` uses `dist/.next-dev`, `next build` uses `dist/.next`. They used to share one, and a build run while a dev server was up rewrote that server's routing state in place — the dev server kept answering, but every `/api/*` route resolved to the not-found page, so next-auth's session fetch failed with `CLIENT_FETCH_ERROR` ("Unexpected token '<'") on every page, and the generated `routes.d.ts` was left corrupted so the next build failed too. Do not point them back at the same directory.
- **On Vercel, `distDir` is not set at all** — the platform collects the built app from Next's default `.next`, so a custom output directory makes the deploy fail at finalization with "could not find `/vercel/path0/user/.next`" *after* a build that succeeded. Vercel's own "Output Directory" field does not redirect this for a Next project. Both `next.config.js` files therefore omit the key when `process.env.VERCEL` is set (`isVercelBuild`) and keep the local split otherwise. There is no dev server on Vercel, so nothing is lost. Verify a change to this by running `VERCEL=1 yarn build` and checking for `.next/BUILD_ID`, then `yarn build` and checking `dist/.next/BUILD_ID`.

## The Proxy Matcher Is A Whitelist Of Asset Extensions, Never `\.[\w]+$`

`proxy.ts` runs on every matched request: it decrypts a session JWT with
`getToken()`, and it sets `Cache-Control: no-store, no-cache, must-revalidate`
on the response. Both are correct for a page render and wrong for a static file.

The matcher originally excluded only `api`, `_next/static`, `_next/image`,
`favicon.ico`, `sitemap.xml` and `robots.txt`. Everything in `user/public/` is
served from the **root** path — `no_avatar.jpeg`, `dark_bg_default.png`,
`icons/*.png`, `upload_icon.svg`, `file-sw.js` — so all ~30 of them ran the
proxy and came back uncacheable. `_next/static` bundles were fine; the images
and the service worker were not.

The obvious fix is the wrong one. **A generic `.*\.[\w]+$` exclusion breaks
every creator profile.** Profiles are a root-level `/[creator]` segment and a
username may contain a dot — *every* seeded demo account is of that shape
(`maitran.eats`, `diego.streetbites`, `sofia.builds`). Excluding them from the
edge means no recommendation-subject cookie and no viewport hint on a first
visit that lands on a profile, silently.

So the exclusion is a whitelist of real asset extensions, and an extension a
person could plausibly end a username with must not be added to it.

`proxy.spec.ts` pins both directions, and the asset half **reads
`user/public/` from disk** rather than listing paths literally — dropping a
`.woff2` or an `.mp4` in there and forgetting the matcher is precisely the
regression it exists to catch, and a hand-written list would keep passing.
