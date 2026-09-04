# Free-tier deployment: feasibility study (HISTORICAL)

> **Superseded on 2026-09-04 — Render is retired and is not a deployment
> target.** This study is kept because its measurements are still the reason the
> current architecture looks the way it does, not because anything here should
> be followed.
>
> The blockers below were all consequences of Render Free's 0.1 CPU / 512 MB /
> no-persistent-disk shape. The chosen host — a GCE `e2-medium`, 2 vCPU, 4 GB —
> resolves every one of them: FFmpeg's measured 392 MB peak fits, transcoding
> runs at ~2 vCPU rather than 0.1, and Redis and MongoDB are containers on the
> same box rather than a metered third-party quota.
>
> What survives and still applies: the FFmpeg CPU/RSS measurements (they set the
> memory limits in `deploy/docker-compose.yml`), the count of 29 BullMQ workers,
> and the finding that `r2.dev` is development-only — which is why media is
> served by a Worker.
>
> Current target: **[`README.md`](./README.md)**.


**Date: 2026-09-04**
**Verdict: NOT feasible as specified. Three blockers, all measured. An
architecture decision is required before any further deployment work.**

Target under evaluation: `user` + `admin` on Vercel Hobby, API + BullMQ workers +
file-server on **one Render Free web service**, MongoDB Atlas Free, Upstash Redis
Free, Cloudflare R2, **no purchased domain**, cost 0.

---

## 1. Conclusion table

| # | Item | Feasible | Evidence | Risk | Decision |
|---|---|---|---|---|---|
| 1 | Render Free supports Docker w/ FFmpeg + Sharp | **Yes** | Render docs list Docker as a supported deploy method; image is ours, so `apt-get install ffmpeg` is available | Sharp needs glibc — must not use Alpine | OK |
| 2 | Render Free RAM / CPU / disk | **No** | Render: **0.1 CPU, 512 MB RAM**, **no persistent disk** on free web services | See blockers B1, B2 | **BLOCKER** |
| 3 | Render Free sleep / cold start | Yes, degraded | Spins down after **15 min** without inbound traffic; spin-up "about one minute"; 750 instance-hours/month | ~60 s first-load; long transcodes are not inbound traffic so the service can sleep mid-job | Needs cold-start UX (§8 of brief) |
| 4 | Public ports per Render web service | **One** | "Render forwards inbound traffic to only *one* HTTP port per web service"; must bind `0.0.0.0`, `PORT` default 10000 | file-server must be mounted/proxied behind the API | Solvable |
| 5 | Current process count | 2 processes | `api` and `file-server` are separate Nest apps, each with its own `main.ts` and HTTP listener | Needs one entrypoint + signal forwarding | Solvable |
| 6 | Where BullMQ workers boot | **In-process in the API** | `QueueService.processWorker` / `QueueMessageService.subscribe` construct `new Worker(...)` inside the Nest app; there is no separate worker executable | No extra service needed | OK |
| 7 | Does file-server need its own port | Yes today | It is a full Nest app with `ServeStaticModule` and a TUS server bound to its own listener | Can listen on `127.0.0.1` inside the container and be proxied | Solvable |
| 8 | Upload/TUS + FFmpeg temp disk | **Ephemeral only** | Render Free "cannot" attach a persistent disk; container FS is lost on redeploy/spin-down | In-flight TUS uploads lost on spin-down | Degraded, acceptable for demo |
| 9 | Upstash Free vs BullMQ commands | **No** | Free = **500K commands/month**. This repo runs **29 BullMQ workers** | See blocker B3 | **BLOCKER** |
| 10 | Idle command estimate | ~5.8 cmd/s | 29 workers × 1 blocking re-issue / 5 s (BullMQ default block timeout) | ≈ 500K commands in **~24 h of uptime** | **BLOCKER** |
| 11 | MongoDB Atlas M0 fits Render | **Yes** | M0: 512 MB storage, **500 connections**, 100 ops/s, 10 GB in/out per 7 days, pauses after 30 days idle | Render has no static outbound IP → needs `0.0.0.0/0` allowlist + strong credentials | OK, documented trade-off |
| 12 | R2 public delivery without custom domain | **Yes** | `r2.dev` is documented as rate-limited and "should only be used for development purposes" — so **not** it. A **Worker with an R2 binding on `workers.dev`** works: `get(key, { range: request.headers })`, `writeHttpMetadata()`, `httpEtag`. Workers Free = 100k req/day, 128 MB, 10 ms CPU (streaming pass-through, so CPU is not per-byte) | 100k req/day shared across the account | **OK — this is the answer** |

---

## 2. The three blockers

### B1 — FFmpeg does not fit in 512 MB alongside the app

Measured locally on the **production builds**, idle, no traffic:

| Process | Working set | Private |
|---|---|---|
| `api` (29 BullMQ workers, Socket.IO, Mongoose) | 169.7 MB | 178.7 MB |
| `file-server` | 133.8 MB | 157.7 MB |
| **Combined idle** | **303.5 MB** | **336.4 MB** |

Then one transcode of a real demo video — `pexels-32353617.mp4`, 20 s, 720p,
15 MB — using **this repo's own settings** (`libx264 -preset fast -crf 23`,
from `video.service.ts`):

| FFmpeg configuration | Peak RSS | CPU time |
|---|---:|---:|
| repo default (multi-threaded) | **392 MB** | 79.3 s |
| `-threads 1 -preset fast` | 233 MB | — |
| `-threads 1 -preset veryfast` | 173 MB | 22.1 s |
| `-threads 1 -preset ultrafast -vf scale=-2:480` | 106 MB | 11.3 s |

Against the **512 MB** cap:

- repo default: 303 + 392 = **~696 MB → OOM**
- `-threads 1 -preset veryfast`: 303 + 173 = **~477 MB**, 35 MB headroom — no room for Sharp, heap growth, or a second concurrent request
- `-threads 1 -preset ultrafast -vf scale=-2:480`: 303 + 106 = **~410 MB**

Only the last one leaves meaningful headroom, and it means **every video on a
video-sharing portfolio demo is re-encoded to 480p ultrafast**. That damages the
artefact the deployment exists to show.

*Caveat, stated plainly:* measured on Windows. Linux RSS for the same work is
typically somewhat lower, but not by the ~200 MB that would change this
conclusion. These are also single-transcode figures with no concurrency.

### B2 — 0.1 CPU makes transcoding impractical

0.1 CPU is one tenth of a vCPU. Extrapolating the measured CPU time:

| Configuration | CPU per 20 s clip | Wall clock at 0.1 CPU |
|---|---:|---:|
| `-threads 1 -preset veryfast` | 22.1 s | **~3.7 min** |
| `-threads 1 -preset ultrafast` 480p | 11.3 s | **~1.9 min** |

The demo dataset contains **224 video files**. Seeding through the real upload
pipeline on Render Free would take **7–14 hours of continuous transcoding** — on
a service that **spins down after 15 minutes without inbound traffic**, and a
transcode is not inbound traffic. The seed would repeatedly sleep mid-run.

### B3 — Upstash Redis Free is exhausted by idle BullMQ polling

This repo runs **29 BullMQ workers**, counted from source:

- `api`: 20 × `queueMessageService.subscribe(...)` + 7 × `queueService.processWorker(...)` = **27**
- `file-server`: 2 × `subscribe(...)` in `file-process.listener.ts` = **2**

Every BullMQ `Worker` holds its **own blocking connection** — BullMQ's own docs:
*"Classes that need blocking Redis commands, such as Worker and QueueEvents,
will create duplicated connections internally."* The blocking command is
re-issued on a ~5 s timeout while idle.

```
29 workers ÷ 5 s  =  5.8 commands/second, doing nothing
                  =  20,880 commands/hour
Upstash Free      =  500,000 commands/month
                  →  exhausted in ~24 hours of uptime
```

That is **before** any application traffic — sessions, rate limiting,
recommendation sessions, socket presence all add to it. Upstash's own BullMQ
page warns about exactly this: *"BullMQ accesses Redis regularly, even when
there is no queue activity. This can incur extra costs."*

**Alternatives checked, both also constrained:**

| Provider | Free limits | Verdict |
|---|---|---|
| Upstash | 256 MB, **500K commands/month** | Exhausted in ~1 day of uptime |
| Redis Cloud Essentials | 30 MB, **30 connections**, 100 ops/s | 29 workers × 2 connections = **58** — over the limit. Even sharing the non-blocking client leaves ~30 blocking connections, at the cap with nothing spare |
| **Render Key Value** | Valkey 8, 25 MB, **50 connections**, **no persistence on free** | **The only one that fits** — and only if BullMQ is given a shared connection so it duplicates just for blocking (≈30 conns, not 58). Job state is lost on restart |

Note the incompatibility claims found online refer to the `@upstash/redis`
**REST** client, which cannot do blocking commands. Over TCP/TLS (`rediss://`)
BullMQ does work with Upstash — the blocker here is quota, not protocol.

---

## 3. What would make it feasible (all still free — your decision, not mine)

I have **not** implemented any of these. Each needs your approval because each
changes either the product or the agreed target.

1. **Redis → Render Key Value Free** instead of Upstash, plus sharing the
   BullMQ base connection. Cost: job state is not durable across restarts.
2. **Seed from this machine, not from Render.** Point the local file-server at
   Atlas + R2 and run `demo:seed` locally: transcoding happens on 12 cores in
   minutes, and objects land in R2 **through the real upload pipeline**, so file
   records still point at R2. This removes B2 for seeding entirely.
3. **Runtime video upload**: either constrain FFmpeg (`-threads 1`, veryfast or
   ultrafast/480p) and document it as slow (~2–4 min per short clip) with real
   OOM risk, or disable video upload on the public demo and present the seeded
   catalogue.

Even with all three, the honest position is: **browsing the seeded demo would
work well** (media is served by Cloudflare, not Render), while **uploading video
on the live site would be slow and memory-risky**.

---

## 4. Status

```
FREE ARCHITECTURE FEASIBLE: NO   (as specified: Upstash + FFmpeg on one Render Free service)
LOCAL READINESS:            PASS
CLOUD RESOURCES CREATED:    NO
STAGING DEPLOYED:           NO
PRODUCTION DEPLOYED:        NO
```

Per the brief, work stops here pending your architecture decision. No VPS or
paid service has been re-introduced, and no workaround above has been built.

### Sources

- [Render — Free instance types](https://render.com/docs/free)
- [Render — Compute plans (0.1 CPU / 512 MB)](https://render.com/docs/compute-plans)
- [Render — Web services: one HTTP port](https://render.com/docs/web-services)
- [Render — Key Value (Valkey)](https://render.com/docs/key-value)
- [Upstash — Redis pricing & limits](https://upstash.com/docs/redis/overall/pricing)
- [Upstash — BullMQ integration](https://upstash.com/docs/redis/integrations/bullmq)
- [BullMQ — Connections](https://docs.bullmq.io/guide/connections)
- [MongoDB Atlas — free cluster limitations](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)
- [Cloudflare — R2 public buckets / r2.dev](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [Cloudflare — R2 Workers API (Range)](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/)
- [Cloudflare — Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
