# Deployment

**Last updated: 2026-09-04**

Target: **Google Compute Engine VM + Vercel + Cloudflare R2.**

> **Status: cloud resources exist; nothing is deployed yet.** The VM, both R2
> buckets and both R2 API tokens have been created. No code has been shipped to
> them, no secret has been filled in, and no browser acceptance has run. See
> [§9 What you must do](#9-what-you-must-do).
>
> Superseded plans, kept only as history: the generic VPS + custom-domain
> version of this document (rewritten below) and
> [`free-tier-feasibility.md`](./free-tier-feasibility.md), the Render Free
> study. **Render is retired** — its 0.1 CPU / 512 MB could not run FFmpeg. The
> e2-medium resolves every blocker that study measured.

---

## 1. Architecture

```
                     ┌──────────────────── Vercel (Hobby) ──────┐
  <user>.vercel.app  │  user   (Next.js, SSR + proxy.ts)        │
  <admin>.vercel.app │  admin  (Next.js)                        │
                     └──────────────────────────────────────────┘
                              │ https                    ▲
                              ▼                          │ media
   api.<IP>.sslip.io  ┌─── GCE douyin-prod-01 ────────┐  │
 files.<IP>.sslip.io  │  nginx + certbot  :80 :443    │  │
                      │  ── the only public entry ──  │  │
                      │  docker compose (bridge net)  │  │
                      │    api          127.0.0.1:8080│  │
                      │    file-server  127.0.0.1:8000│  │
                      │    mongodb      no host port  │  │
                      │    redis        no host port  │  │
                      └───────────────────────────────┘  │
                                                         │
   <worker>.workers.dev  ┌─ Cloudflare Worker ─────────┐ │
                         │  R2 binding, read-only      │─┘
                         │  Range/206, ETag, CORS      │
                         └──────────┬──────────────────┘
                                    ▼
                         douyin-media-production (private bucket)
```

**Two things are worth stating precisely, because the previous version of this
document overstated one of them.**

*Download and playback* go browser → Cloudflare Worker → R2. They never touch
the VM. That is what keeps a 2 vCPU box viable for a video site, and it matters
for cost: GCE egress is metered, Cloudflare R2 egress is not.

*Upload and processing* **do** go through the VM: the browser uploads to
`files.<IP>.sslip.io`, and the file server runs ffprobe, FFmpeg and Sharp there
before writing the result to R2. So "media never transits the backend" is false
and is not claimed here — only the read path bypasses it.

**Why the Worker rather than `r2.dev`.** `r2.dev` is disabled on both buckets,
and Cloudflare documents it as rate-limited and "should only be used for
development purposes". A custom domain needs a domain nobody has bought. A
Worker with an R2 **binding** is the remaining supported route, and it is better
than either: the bucket stays private, no S3 key exists at the edge, and every
response passes through code with tests.

**Why sslip.io.** Let's Encrypt needs a hostname; `sslip.io` resolves
`anything.<IP>.sslip.io` to that IP with no account, no record and no cost, so
HTTP-01 works today. Moving to a real domain later is a `server_name` change and
a fresh certbot run — nothing in the application depends on the hostname shape.

---

## 2. Environment matrix

No values here. Everything is filled in by you, in the place named.

**S** = secret (never in a browser bundle, never committed) · **P** = public.
"Redeploy" = the change only takes effect after a rebuild/redeploy.

### 2.1 `deploy/.env` on the VM — `chmod 600`, git-ignored

| Variable | S/P | Required | Notes |
|---|:--:|:--:|---|
| `MONGO_ROOT_USERNAME` / `MONGO_ROOT_PASSWORD` | S | yes | Compose builds the in-network URI from these. Mongo publishes no host port. |
| `REDIS_PASSWORD` | S | yes | Second factor; Redis is unreachable from outside regardless. |
| `MONGO_DATABASE` | P | yes | `douyin-clone`. Separate DB name per environment. |
| `USER_APP_URL` | P | yes | The user app's canonical https origin. **Every emailed link is built from this alone.** API refuses to start if it is not https. Known only after Vercel exists. |
| `BASE_URL` | P | yes | `https://api.<IP>.sslip.io`. |
| `CORS_ORIGIN` | P | yes | Exact Vercel origins, comma-separated. **Both services refuse to start without it.** |
| `TRUST_PROXY_HEADERS` | P | yes | `true` behind nginx, or every rate limit keys on the proxy. |
| `FILE_SERVER_API_KEY`, `FILE_SERVER_JWT_SECRET`, `INTERNAL_API_KEY` | S | yes | Shared api↔file-server. **Values must match on both sides.** |
| `JWT_SECRET`, `API_SECRET_KEY` | S | yes | file-server signing and internal auth. `JWT_SECRET` has no fallback — signing fails closed. |
| `STORAGE_DRIVER` | P | yes | `r2`. |
| `R2_ACCOUNT_ID`, `R2_ENDPOINT` | S* | yes | Endpoint is `https://<account id>.r2.cloudflarestorage.com`. Not secret in itself, but identifies the account — keep it out of the browser. |
| `R2_BUCKET_NAME` | P | yes | `douyin-media-production`. |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | **S** | yes | **The production token, and this file is the only place it goes.** Never in the Worker (binding), never in Vercel, never `NEXT_PUBLIC_*`. |
| `R2_PUBLIC_BASE_URL` | P | yes | The Worker origin, `https://<worker>.<subdomain>.workers.dev`. Not `r2.dev`, not the S3 endpoint. |
| `VIDEO_PROBE_CONCURRENCY`, `IMAGE_VALIDATION_CONCURRENCY` | P | yes | `1` on this box. Also set in compose. |
| `MAIL_PROVIDER`, `SMTP_*`, `MAIL_FROM_*` | S | yes | `smtp`; the API refuses `log` in production. |
| `ALLOW_PRODUCTION_DEMO_SEED` / `_CLEAN` | P | no | Leave `false`; type on the command line for one invocation. |

### 2.2 Vercel — `user` project (root directory `user`)

| Variable | S/P | Notes |
|---|:--:|---|
| `API_SERVER_ENDPOINT` | P | `https://api.<IP>.sslip.io`. Server-side; Vercel reaches the VM over the internet. |
| `NEXT_PUBLIC_API_ENDPOINT` | P | Same origin, compiled into the browser bundle. Redeploy to change. |
| `PROXY_API_TARGET` | P | Same origin. Keeps the browser same-origin with the API. |
| `SITE_URL` / `NEXT_PUBLIC_SITE_URL` | P | This project's own `*.vercel.app` origin. |
| `NEXTAUTH_URL` | P | Must equal this project's production origin exactly, or the session cookie is issued for the wrong domain and silently never persists. |
| `NEXTAUTH_SECRET` | **S** | Distinct from admin's. |

No R2 or media variable exists here, by design: media URLs arrive from the API
already absolute. If images 404 in production, `R2_PUBLIC_BASE_URL` on the VM is
what is wrong.

`next/image` needs no Worker entry today (`images.unoptimized: true`), and there
is no CSP to extend. Both were checked — see §6 for the trap if that changes.

### 2.3 Vercel — `admin` project (root directory `admin`)

| Variable | S/P | Notes |
|---|:--:|---|
| `API_SERVER_ENDPOINT`, `NEXT_PUBLIC_API_ENDPOINT`, `PROXY_API_TARGET` | P | Same API origin. |
| `NEXTAUTH_URL` | P | This project's own origin. |
| `NEXTAUTH_SECRET` | **S** | **Different** from the user app's. |

The admin origin must also be in the VM's `CORS_ORIGIN`.

### 2.4 Cloudflare Worker — `deploy/r2-worker/wrangler.toml`

| Setting | S/P | Notes |
|---|:--:|---|
| `r2_buckets` binding `MEDIA_BUCKET` | P | Bucket name only. **No key** — this is why no R2 secret reaches the edge. |
| `ALLOWED_ORIGINS` | P | Exact Vercel origins. Empty does not block media (it is public); it only stops cross-origin script reading the bytes. |
| `CACHE_CONTROL` | P | Immutable default; keys are content-addressed and never rewritten. |

### 2.5 Local machine — staging verification only

| Variable | S/P | Notes |
|---|:--:|---|
| `R2_*` (staging token) | **S** | Points at `douyin-media-staging`. Used by `yarn verify:r2`. **Never** put the staging token on the VM, and never the production token in this local file. |

---

## 3. Deployment order

Each step gates the next. Do not skip ahead.

### A. Code and config — done
Storage provider, health endpoints, guards and the Worker are in the repo and
tested locally. Nothing here needs a credential.

### B. Verify R2 against **staging** — do this first
On your machine, with the *staging* token in `file-server/.env`:

```bash
cd file-server && yarn build && yarn verify:r2
```

Uploads an image and a video under a unique `_verify/<run id>` prefix, checks
`Content-Type`/`Cache-Control` survived, fetches over HTTPS, asserts `Range`
returns `206` with correct `Content-Range` and bytes (including a seek near the
end), deletes, confirms removal, and lists the prefix to prove nothing is left.
It touches nothing outside its own prefix.

### C. Do not touch the production bucket until B passes.

### D. Bootstrap and harden the VM

```bash
# On douyin-prod-01, via SSH-in-browser:
sudo bash deploy/gce/bootstrap.sh
```

Creates 2 GB swap (`vm.swappiness=10`), installs Docker + Compose + nginx +
certbot, caps daemon logs, and enables `ufw` (22/80/443).

SSH hardening is written to a drop-in, validated with `sshd -t`, and applied
with **reload, not restart** — existing sessions survive, so a mistake is still
recoverable from the terminal that made it. It **refuses** to disable password
auth unless a key or OS Login is already present. **Open a second SSH session
and confirm access before closing the first.**

### E. Deploy the stack

```bash
cp deploy/.env.example deploy/.env && chmod 600 deploy/.env
$EDITOR deploy/.env          # §2.1
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Then nginx and TLS:

```bash
export VM_IP=<static IPv4>
sed "s/__VM_IP__/${VM_IP}/g" deploy/nginx/douyin-clone.conf \
  | sudo tee /etc/nginx/sites-available/douyin-clone >/dev/null
sudo ln -sf /etc/nginx/sites-available/douyin-clone /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.${VM_IP}.sslip.io -d files.${VM_IP}.sslip.io
```

### F. Health over HTTPS

```bash
curl -fsS https://api.${VM_IP}.sslip.io/health          # from anywhere
curl -fsS http://127.0.0.1:8080/health/ready            # on the VM only
curl -fsS http://127.0.0.1:8000/health/ready            # on the VM only
```

Readiness is loopback-only in nginx on purpose: it names failing dependencies.
Liveness deliberately checks nothing, so a database blip does not cause a
restart loop.

### G. Deploy the Worker and check Range

```bash
cd deploy/r2-worker
npm test                      # 29 tests, no network needed
npx wrangler login
npx wrangler deploy --env staging
npx wrangler deploy --env production
```

Then put the production Worker URL in `R2_PUBLIC_BASE_URL` and restart the
file-server. Verify a real video seek:

```bash
curl -sI  "$R2_PUBLIC_BASE_URL/<a video key>"
curl -si -H 'Range: bytes=100-199' "$R2_PUBLIC_BASE_URL/<a video key>" | head -20
# expect: 206, Content-Range: bytes 100-199/<size>, Content-Length: 100
```

### H. Seed production **from your machine**

Run the seeder locally against the production API. It goes through the real
upload pipeline, so file records point at R2 exactly as a user upload would —
and transcoding happens on your CPU rather than costing the VM hours.

```bash
cd api
ALLOW_PRODUCTION_DEMO_SEED=true yarn demo:seed
```

Never `mongodump`/`mongorestore` the local database into production: `files`
rows carry `storageType` and paths describing your disk, and importing them
produces records pointing at objects R2 has never held.

### I. Seed again — must create 0 entities.
### J. `yarn demo:verify`.

### K. Vercel — only once the backend is stable on HTTPS

Two projects, root directories `user` and `admin`. Set §2.2/§2.3, deploy, then
go back and update the VM's `CORS_ORIGIN` and `USER_APP_URL` with the real
`*.vercel.app` origins and restart the stack. Update the Worker's
`ALLOWED_ORIGINS` and redeploy it too.

### L. Browser acceptance

Guest browse, login, Home, For You, post detail, photo **and** video (with a
real seek), upload, notification, message, realtime across two contexts, admin
login and category CRUD. **Nothing is production-ready before this passes.**

---

## 4. Demo data safety

`demo:seed` and `demo:clean` infer their target from `MONGO_URI` and refuse
anything that is not localhost, or any `NODE_ENV=production`.

| Command | localhost | production |
|---|---|---|
| `demo:seed` | runs | needs `ALLOW_PRODUCTION_DEMO_SEED=true` |
| `demo:clean` | runs | needs `ALLOW_PRODUCTION_DEMO_CLEAN=true` |
| `demo:clean` with env opt-in, no `--confirm-production` | — | **forced `--dry-run`** |
| `demo:clean --confirm-production` + env opt-in | — | deletes |

The seed opt-in is not accepted as permission to clean.

---

## 5. Cost — read this

**The VM is not free, and the demo has an expiry date.**

Verified against Google's Free Tier documentation:

- Always Free covers **one `e2-micro`** in `us-west1`/`us-central1`/`us-east1`
  with **standard** persistent disk. **`e2-medium` is not included**, `pd-balanced`
  is not included, and `asia-southeast1` is not a Free Tier region. The VM runs
  entirely on **Free Trial credits**.
- When the trial ends — 90 days, or the credit is spent — and the account has
  **not** been upgraded: *"All resources you created during the trial are
  stopped"*, then a **30-day grace period**, after which *"your Free Trial
  resources are permanently deleted."*

So: no surprise bill (an un-upgraded account cannot be charged), but the site
stops, and after the grace period **the VM and its disk — including MongoDB —
are deleted**.

| Resource | Metered | Note |
|---|---|---|
| e2-medium, asia-southeast1-b | yes, on credits | ~$25–35/mo equivalent if paid |
| 30 GB pd-balanced | yes, on credits | |
| Static external IP | free **while attached to a running VM**; charged when unattached or the VM is stopped | Do not stop the VM and leave the IP reserved |
| GCE egress to internet | metered | Kept small because media is served by Cloudflare, not the VM |
| Cloudflare R2 storage | 10 GB free | Demo dataset fits |
| **R2 egress** | **always free** | The reason media delivery is off the VM |
| Workers | 100k req/day free | Each media fetch is one request |
| Vercel Hobby | free | Non-commercial only |

**Consequences to plan for:** back MongoDB up **off the VM** (§7), and note that
R2 lives in Cloudflare and survives the VM's deletion — media persists even if
the VM does not.

---

## 6. Front-end host allowlists — checked, no change needed

Worth recording because both are easy to assume wrong:

- **`next/image` remote hosts.** `user/next.config.js` sets
  `images.unoptimized: true`, so Next renders a plain `<img>` and the
  `remotePatterns` allowlist is **not enforced**. The Worker host therefore
  needs no entry today. *The trap:* if anyone turns optimization on later,
  every avatar and cover 400s until the Worker host is added first.
- **CSP.** There is no Content-Security-Policy anywhere in `user/` or `admin/` —
  `admin/next.config.js` sets `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy` and `Permissions-Policy` only. So there is no `img-src` or
  `media-src` to extend for the Worker origin. If a CSP is introduced later it
  must list the Worker host, the API origin and the WebSocket origin.

**Admin indexability — fixed in this round.** The admin app had no `robots`
directive at all, so on a public `*.vercel.app` origin the dashboard would have
been crawlable. `admin/src/app/layout.tsx` now emits
`robots: { index: false, follow: false }` and `admin/src/app/robots.ts`
disallows crawling. Neither is access control — the API's role guards are — but
an admin panel should not be advertised in search results.

---

## 7. Backup and rollback

### Back up MongoDB off the VM

The VM disk is trial-scoped and has no snapshot schedule (disabled by request),
so the only durable copy is one you pull down:

```bash
docker compose -f deploy/docker-compose.yml exec -T mongodb \
  mongodump --username admin --password "$MONGO_ROOT_PASSWORD" \
  --authenticationDatabase admin --archive --gzip > backup-$(date +%F).gz
# then copy it off the VM
```

Do this before any migration that mutates data, and before the trial expires.

### Application rollback

```bash
git checkout <previous commit>
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

**Rolling back the application never deletes R2 objects.** Media outlives
deployments; an older image reads the same bucket.

### Migrations

| Migration | Reversible |
|---|---|
| Index creation | Yes — dropping an index loses no data |
| `1788000100000-backfill-post-reco-shuffle-key` | **No** — writes a value where none existed; rolling back leaves it populated (harmless, but not undone) |
| Settings seeds | Yes, by removing the seeded rows |

### Storage

`STORAGE_DRIVER` back to `disk` makes **new** uploads local while everything
already in R2 keeps resolving to R2 — reads dispatch on each file's own
`storageType`. No data migration either way, and nothing is deleted. Keep the
`file-public` volume.

### Worker

`npx wrangler rollback --env production`, or redeploy a previous commit. The
bucket is untouched either way.

---

## 8. Troubleshooting

**Media 404s everywhere** — `R2_PUBLIC_BASE_URL` is wrong, or the Worker is not
deployed. The web apps have no media variable to get wrong.

**Media loads but video will not seek** — the Worker is not returning `206`.
Check `Content-Range` with the `curl` in step G.

**Images blocked in the browser console, cross-origin** — the Worker's
`ALLOWED_ORIGINS` does not list the Vercel origin.

**Uploads fail, viewing works** — uploads are the only path through the VM.
Check `CORS_ORIGIN`, then `docker compose logs file-server`, then
`/health/ready` for `tempDir`.

**Realtime silently degrades** — Socket.IO fell back to long-polling because
`Upgrade`/`Connection` are not forwarded. Confirm the `map $http_upgrade
$connection_upgrade` block is present; it is not a built-in variable.

**Everyone rate-limited at once** — `TRUST_PROXY_HEADERS` unset.

**A container keeps restarting** — likely OOM. `docker stats`, then
`dmesg | grep -i oom`. The limits in compose are sized so this should be FFmpeg
under an unusually large upload; the fix is a smaller upload limit, not a bigger
swapfile.

---

## 9. What you must do

Nothing below can be done from this repository.

1. **Nothing yet on the VM** — bootstrap it (step D) when ready.
2. **Fill `deploy/.env` on the VM** (§2.1). The **production** R2 token goes
   here and nowhere else.
3. **Keep the staging token local** for `yarn verify:r2` only.
4. **Deploy the Worker** (step G) and copy its `workers.dev` URL into
   `R2_PUBLIC_BASE_URL`.
5. **Create the two Vercel projects** (step K), then return and update
   `CORS_ORIGIN`, `USER_APP_URL` and the Worker's `ALLOWED_ORIGINS`.
6. **Gmail App Password** for SMTP.

I will not create accounts, provision resources, change billing, or ask for a
secret in chat. Fill them in the files and dashboards named above.
