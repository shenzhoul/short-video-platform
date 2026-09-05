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

## Do Not `preventDefault` A Wheel You Are Not Consuming

React attaches `wheel` passively, so `preventDefault()` in an `onWheel` handler
suppresses nothing and logs "Unable to preventDefault inside passive event
listener invocation" on every tick. `usePostNavigationWheel` therefore returns
early when neither direction can navigate — with a reading panel open the scroll
belongs to the panel — and guards the call with `event.cancelable`.

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
