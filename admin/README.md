# Admin Web App

Administration interface for the Douyin Clone platform: dashboard, user and admin management,
permissions, system settings, and log viewers.

Built with Next.js 16 (App Router), React 19, TypeScript, Ant Design 6, TanStack Query, and NextAuth.

| Item | Value |
| --- | --- |
| Package | `douyin-clone-admin` |
| Dev/start port | `8082` |
| Node | `>= 22` |
| Depends on | [API](../api/README.md) on `8080`, [file server](../file-server/README.md) on `8000` |

## Getting Started

```bash
yarn install
cp .env.example .env   # then fill in NEXTAUTH_SECRET
yarn dev               # http://localhost:8082
```

`/` redirects to `/dashboard`. Sign in with an admin account: running `yarn migrate` in
[`api/`](../api/README.md#migrations) seeds a `superadmin` account with the default password
`adminadmin`. Change it before exposing the environment to anyone else.

### Environment

| Variable | Purpose |
| --- | --- |
| `API_SERVER_ENDPOINT` | API base URL used by server components and NextAuth |
| `NEXT_PUBLIC_API_ENDPOINT` | API base URL used by the browser. Leave empty to use the `/api/v1` rewrite instead |
| `NEXTAUTH_URL` | NextAuth callback base URL (`http://localhost:8082`) |
| `NEXTAUTH_SECRET` | Session/JWT secret — required |
| `PROXY_API_TARGET` | Rewrite target for `/api/v1/*` (default `http://localhost:8080`) |

Generate the secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`next.config.js` rewrites `/api/v1/:path*` to `${PROXY_API_TARGET}/:path*`, stripping the prefix. The
admin app has no socket or file proxy: uploads go directly to the file server using a target
requested from the API. Details are in [../user/src/PROXY_SETUP.md](../user/src/PROXY_SETUP.md).

## Scripts

```bash
yarn dev     # dev server on 8082
yarn build   # production build (output in dist/.next)
yarn start   # serve the production build on 8082
yarn lint    # eslint --fix over src/
```

Run `yarn lint` and `yarn build` before finishing any change in this app.

> `package.json` declares `test`/`test:watch`/`test:coverage`, but this app has no Jest config and no
> test files yet. Adding tests means adding the config first — do not claim coverage here.

## Routes

| Route | Purpose |
| --- | --- |
| `/dashboard` | Overview |
| `/identity/users` | User list |
| `/identity/users/create`, `/identity/users/update/[id]` | Create and edit users |
| `/identity/users/admin-management` | Admin accounts and permissions |
| `/system/settings` | System settings groups |
| `/system/logger/system-logs` | Application logs |
| `/system/logger/request-logs` | HTTP request logs |
| `/system/logger/http-exception-logs` | Handled HTTP exceptions |
| `/system/logger/audit-logs` | Audit trail |
| `/account/settings` | Signed-in admin's own account |
| `/auth`, `/auth/login`, `/auth/forgot`, `/auth/logout` | Auth flows |

`src/proxy.ts` is the Next.js 16 middleware (the renamed `middleware.ts`). Every non-auth route
requires a session, and the middleware re-verifies the account against `GET /users/me` so an expired
token or a revoked admin flag is caught instead of trusting the cached session. It does not proxy
API traffic — that is `next.config.js` `rewrites()`.

## Project Structure

```text
src/
├── app/
│   ├── (main)/         # authenticated admin sections
│   └── auth/           # login, forgot, logout
├── components/
│   ├── auth/           # sign-in forms
│   ├── common/         # shared building blocks
│   ├── file/           # upload widgets
│   ├── logger/         # log tables and filters
│   ├── settings/       # settings form, renderers, settings-menu.tsx
│   ├── user/           # user management UI
│   └── ui/             # primitives
├── services/           # API clients (auth, user, setting, logger, file upload)
├── hooks/              # data and UI hooks
├── layout/             # shell, header, sidebar
├── context/, providers/, constants/, interfaces/, lib/, utils/, style/
└── proxy.ts            # Next 16 middleware
```

## Conventions

- Filenames are lowercase kebab-case, except framework-reserved files (`page.tsx`, `layout.tsx`, ...).
- API request logic stays in `src/services/`; components consume hooks, not `axios` directly.
- Ant Design 6 is the UI library. Treat `package.json` as the source of truth for the version and
  avoid deprecated props or examples copied from antd 4/5.
- Use `@douyin-clone/shared-toast` for toasts. Do **not** use antd `message` or `notification` for
  runtime toasts.
- Split large pages into feature components and extract stateful logic into hooks.
- A new settings group must be registered in
  [`src/components/settings/components/settings-menu.tsx`](./src/components/settings/components/settings-menu.tsx),
  otherwise admins cannot reach it.

## Further Reading

- [`AGENTS.md`](./AGENTS.md) — working rules for this app
- [`../.agents/rules/admin.md`](../.agents/rules/admin.md) — structure, antd, and settings rules
- [`../.agents/skills/system-settings/SKILL.md`](../.agents/skills/system-settings/SKILL.md) — settings lifecycle
- [`../docs/features/admin-operations.md`](../docs/features/admin-operations.md) — current admin capabilities
