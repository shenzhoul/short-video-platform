# User Web App

The public-facing short-video experience: feeds, creator profiles, post detail, search, comments,
reactions, follows, notifications, and the creator publishing workspace.

Built with Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, TanStack Query, NextAuth,
and Socket.IO.

| Item | Value |
| --- | --- |
| Package | `douyin-clone-user` |
| Dev/start port | `8081` |
| Node | `>= 22` |
| Depends on | [API](../api/README.md) on `8080`, [file server](../file-server/README.md) on `8000` |

## Getting Started

```bash
yarn install
cp .env.example .env   # then fill in NEXTAUTH_SECRET
yarn dev               # http://localhost:8081
```

The API and file server must be running for anything beyond static rendering.

### Environment

| Variable | Purpose |
| --- | --- |
| `API_SERVER_ENDPOINT` | API base URL used by server components, `generateMetadata`, and NextAuth |
| `NEXT_PUBLIC_API_ENDPOINT` | API base URL used by the browser. Leave empty to use the `/api/v1` rewrite instead |
| `SITE_URL` / `NEXT_PUBLIC_SITE_URL` | Public site URL used for canonical and social metadata |
| `NEXTAUTH_URL` / `NEXTAUTH_URL_INTERNAL` | NextAuth callback base URLs |
| `NEXTAUTH_SECRET` | Session/JWT secret — required |
| `PROXY_API_TARGET` | Rewrite target for `/api/v1/*` and `/socket.io/*` (default `http://localhost:8080`) |

Generate the secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Request routing, the `/api/v1` rewrite, and the socket proxy are documented in
[src/PROXY_SETUP.md](./src/PROXY_SETUP.md).

## Scripts

```bash
yarn dev              # dev server on 8081
yarn build            # production build (output in dist/.next)
yarn start            # serve the production build on 8081
yarn lint             # eslint --fix over src/
yarn test             # jest (jsdom + next/jest)
yarn test src/hooks   # focused run
ANALYZE=true yarn build  # bundle analyzer
```

Run `yarn lint` and `yarn build` before finishing any change in this app.

## Routes

Route groups make the rendering strategy explicit.

| Route | Group | Purpose |
| --- | --- | --- |
| `/` | public | Landing / home feed entry |
| `/for-you` | public | Recommended feed |
| `/following` | public shell, authenticated data | Posts from followed creators |
| `/search` | public | Search results |
| `/[creator]` | public | Creator profile and their posts |
| `/creator/publish`, `/creator/publish/video`, `/creator/publish/image` | private | Publishing flows |
| `/creator/posts`, `/creator/posts/[id]/edit` | private | Post management and editing |
| `/auth/login`, `/auth/logout`, `/auth/oauth/callback/[provider]` | auth | Sign-in flows |
| `/pip` | utility | Picture-in-picture surface |

`src/proxy.ts` is the Next.js 16 middleware (the renamed `middleware.ts`). It guards `/creator/*`
behind a session, redirects signed-in users away from auth pages, and tags each request with a
`viewport` search param. It does **not** proxy API traffic — that is `next.config.js` `rewrites()`.

Legacy `/post`, `/post/create`, and `/post/image` links are 307-redirected to their `/creator/*`
equivalents in `next.config.js`.

## Project Structure

```text
src/
├── app/
│   ├── (public)/       # SEO-sensitive routes
│   ├── (private)/      # authenticated creator routes
│   ├── auth/           # login, logout, OAuth callback
│   └── api/auth/       # NextAuth route handler
├── components/         # feature-grouped UI (content, comment, notification,
│                       # following, search, creator, layout, shared, ui, ...)
├── hooks/              # data and UI hooks (feeds, post interactions, uploads, sockets)
├── services/           # API clients; all request logic lives here
├── socket/             # Socket.IO client context and listeners
├── providers/          # app-level context providers
├── lib/                # auth options and low-level helpers
├── utils/              # pure helpers (upload, validation, formatting)
├── constants/, interfaces/, icons/
└── proxy.ts            # Next 16 middleware
```

## Conventions

- Filenames are lowercase kebab-case, except framework-reserved files (`page.tsx`, `layout.tsx`, ...).
- API request logic stays in `src/services/`; components consume hooks, not `fetch`.
- Public routes get real SEO metadata; private and utility routes stay `noindex`.
- Styling is Tailwind-first. Dropdown behavior comes from `src/components/ui/dropdown-menu.tsx`, and
  the shared menu motion is defined once in `globals.css`.
- Toasts use `@douyin-clone/shared-toast`; do not import `react-toastify` directly in feature code.
- Uploads go straight to the file server using a target requested from the API. Load
  `tus-js-client` dynamically inside the browser upload path — a static import leaks process
  listeners through HMR.

## Testing

Jest runs through `next/jest` against jsdom, so tests compile exactly like the app. Specs live beside
the code they cover (`src/components/comment/`, `src/components/notification/`, `src/hooks/`,
`src/providers/`) and focus on comment threads, notifications, and real-time post state.

## Further Reading

- [`AGENTS.md`](./AGENTS.md) — working rules for this app
- [`src/PROXY_SETUP.md`](./src/PROXY_SETUP.md) — request routing and rewrites
- [`../.agents/rules/user.md`](../.agents/rules/user.md) — structure, rendering, SEO, and styling rules
- [`../docs/by-pages/README.md`](../docs/by-pages/README.md) — implemented routes
- [`../docs/features/`](../docs/features/) — feature documentation
