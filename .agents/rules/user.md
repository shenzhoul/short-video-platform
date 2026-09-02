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

Rules that follow:

- **Anything that must survive moving between posts belongs in
  `PostDetailModal`**, not in either layout. That includes the open panel tab
  and anything derived from it.
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
  the old behaviour) and `creator-post-order.spec.ts`.

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
