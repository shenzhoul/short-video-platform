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
