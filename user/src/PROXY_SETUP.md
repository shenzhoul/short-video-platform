# Request Routing And Proxy Setup

How browser requests from the `user/` and `admin/` apps reach the API, the Socket.IO gateway, and
the file server.

Source of truth: [`user/next.config.js`](../next.config.js) and
[`admin/next.config.js`](../../admin/next.config.js). Update this document whenever those
`rewrites()` change.

## Overview

```text
Browser (user app, 8081)
├── /api/v1/*    → rewrite → PROXY_API_TARGET/*        (API, 8080 — prefix stripped)
├── /socket.io/* → rewrite → PROXY_API_TARGET/socket.io/*
└── file URLs    → direct   → file server (8000), no proxy

Browser (admin app, 8082)
├── /api/v1/*    → rewrite → PROXY_API_TARGET/*        (API, 8080 — prefix stripped)
└── file URLs    → direct   → file server (8000), no proxy
```

Two different things in this app are called "proxy". Do not confuse them:

| | Purpose |
| --- | --- |
| `next.config.js` → `rewrites()` | Forwards `/api/v1/*` and `/socket.io/*` to the backend. This document. |
| [`src/proxy.ts`](./proxy.ts) | Next.js 16 middleware (the renamed `middleware.ts`): auth guarding and request tagging. It does not forward API traffic. |

## The `/api/v1` Rewrite

```js
// user/next.config.js and admin/next.config.js
const apiTarget = process.env.PROXY_API_TARGET
  || process.env.NEXT_PUBLIC_API_ENDPOINT
  || 'http://localhost:8080';

{ source: '/api/v1/:path*', destination: `${apiTarget}/:path*` }
```

**The `/api/v1` prefix is stripped.** The API has no global route prefix, so the browser path and
the upstream path differ:

| Browser request | Reaches the API as |
| --- | --- |
| `/api/v1/auth/login` | `POST /auth/login` |
| `/api/v1/posts` | `GET /posts` |
| `/api/v1/users/me` | `GET /users/me` |
| `/api/v1/creator/posts` | `GET /creator/posts` |

## The Socket.IO Rewrite (user app only)

```js
{ source: '/socket.io/:path*', destination: `${apiTarget}/socket.io/:path*` }
```

The path is preserved here, and WebSocket upgrades are forwarded. The `admin/` app has no socket
rewrite because it does not open a socket connection.

`src/socket/socket-context.tsx` connects to `NEXT_PUBLIC_API_ENDPOINT` when that variable is set,
and otherwise to the app's own origin, which is where this rewrite takes over.

## Files Are Not Proxied

There is **no `/files/*` rewrite** in either app. Uploads and media reads go straight to the file
server:

1. the client asks the API for an upload target;
2. the API calls the file server's internal endpoint and returns a signed URL plus a token;
3. the browser uploads directly to the file server (`POST /files/upload`, or TUS at `/tus-upload`);
4. media URLs come back from API DTOs and are used as-is.

The file server's location is therefore configured API-side through `FILE_SERVER_BASE_URL`, not in
either frontend. There is deliberately no `PROXY_FILE_TARGET` variable — an earlier one existed but
no rewrite ever read it, so it was removed rather than left as a knob that does nothing.

Never build storage paths in the frontend — use the URLs the API returns. See
[`.agents/skills/file-service-integration/SKILL.md`](../../.agents/skills/file-service-integration/SKILL.md).

## Choosing Base URLs

`APIRequest.getBaseApiEndpoint()` in [`src/services/api-request.ts`](./services/api-request.ts)
resolves the base URL in this order:

1. `APIRequest.API_ENDPOINT` if set programmatically;
2. `NEXT_PUBLIC_API_ENDPOINT` when non-empty — used by the browser, bypassing the rewrite;
3. `API_SERVER_ENDPOINT` when running on the server;
4. `/api/v1` — the rewrite path.

So there are two valid local setups:

| Setup | `NEXT_PUBLIC_API_ENDPOINT` | Effect |
| --- | --- | --- |
| Direct (what `.env.example` ships) | `http://localhost:8080` | The browser calls the API directly. Cross-origin, so the API's `CORS_ORIGIN` must allow `http://localhost:8081` / `:8082`, or be unset. |
| Proxied | empty | The browser calls same-origin `/api/v1/*` and Next forwards it. No CORS involved. |

Server-side code (server components, `generateMetadata`, NextAuth) always needs an absolute URL, so
keep `API_SERVER_ENDPOINT` set in both setups. A relative `/api/v1` cannot be fetched from the
server.

## Environment Variables

```env
# Absolute API URL for server-side rendering, metadata, and NextAuth
API_SERVER_ENDPOINT=http://localhost:8080

# Absolute API URL for the browser. Leave EMPTY to use the /api/v1 rewrite instead.
NEXT_PUBLIC_API_ENDPOINT=http://localhost:8080

# Rewrite target for /api/v1/* and /socket.io/*
PROXY_API_TARGET=http://localhost:8080
```

These are the only routing variables either frontend reads. Uploads need no frontend configuration.

Rewrites are read at server start. Restart `yarn dev` after changing any of these.

## Production

Point the targets at the deployed services:

```env
API_SERVER_ENDPOINT=https://api.yourdomain.com
PROXY_API_TARGET=https://api.yourdomain.com
NEXT_PUBLIC_API_ENDPOINT=          # empty keeps browser traffic same-origin
```

Use HTTPS everywhere, and set `CORS_ORIGIN` on the API to the exact frontend origins when the
browser calls the API directly.

## Verifying

```bash
# API reachable directly
curl -i http://localhost:8080/posts

# Same call through the user app's rewrite (prefix stripped upstream)
curl -i http://localhost:8081/api/v1/posts

# Through the admin app
curl -i http://localhost:8082/api/v1/posts

# File server reachable (uploads bypass Next entirely)
curl -i http://localhost:8000/
```

Ports in use on Windows:

```powershell
netstat -ano | findstr ":8080 :8081 :8082 :8000"
```

For sockets, open the browser devtools Network tab and confirm the `/socket.io/` request upgrades to
`101 Switching Protocols`.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `404` on every `/api/v1/*` call | The API is not running, or `PROXY_API_TARGET` points somewhere else. Remember the prefix is stripped: check the API for `/posts`, not `/api/v1/posts`. |
| Config change had no effect | Rewrites are evaluated at server start — restart `yarn dev`. |
| CORS errors in the browser | You are in the direct setup. Either clear `NEXT_PUBLIC_API_ENDPOINT` to go through the rewrite, or add the frontend origin to the API's `CORS_ORIGIN`. |
| Socket stuck on polling / never connects | `NEXT_PUBLIC_API_ENDPOINT` points at a host that does not serve `/socket.io`, or the deployment does not forward WebSocket upgrades. |
| Uploads fail while normal API calls work | A file-server problem, not a proxy problem. Check that the file server is up on `8000` and that `FILE_SERVER_BASE_URL` plus the shared secrets match between the API and the file server. |
| Redirect loop on `/creator/*` or admin routes | Auth middleware in `src/proxy.ts`, unrelated to rewrites. Check `NEXTAUTH_SECRET` and the session. |

## Related

- [`user/README.md`](../README.md)
- [`admin/README.md`](../../admin/README.md)
- [`api/README.md`](../../api/README.md) — routing model
- [`file-server/README.md`](../../file-server/README.md) — upload endpoints
- [`docs/architecture.md`](../../docs/architecture.md)

_Last updated: 2026-08-18_
