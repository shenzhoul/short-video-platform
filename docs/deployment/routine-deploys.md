# Routine production deploys

**Last updated: 2026-09-06**

Everything runs on one GCE VM (`douyin-prod-01`, e2-medium — 2 vCPU, ~3.8 GB
usable, 30 GB disk) under Docker Compose, behind host nginx. There is no Vercel
project any more: `user` and `admin` are containers on the same box as `api`,
`file-server`, `mongodb` and `redis`.

This document is the *steady-state* procedure — how to ship a commit that is
already merged and tagged. First-time setup, TLS, the Worker and seeding live in
[`README.md`](./README.md).

Every command runs on the VM from the repository root unless it says otherwise:

```bash
cd ~/short-video-platform
```

And every `docker compose` invocation in this document needs both flags. Losing
either one is the most common way to hurt this stack — without `--env-file` the
required variables are unset and compose either fails the `:?` guards or, worse,
falls back to defaults:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env <command>
```

Set an alias for the session so the examples below stay readable:

```bash
alias dc='docker compose -f deploy/docker-compose.yml --env-file deploy/.env'
```

---

## 0. Never do these during a code deploy

| Forbidden | Why |
|---|---|
| `docker compose down` | Stops **every** service including `mongodb` and `redis`, for a change that touches one. Downtime with no benefit. |
| `docker volume rm` / `down -v` | `mongo-data`, `redis-data` and `file-public` are the production database, the session/queue store and any disk-era media. Deleting them is not a deploy, it is data loss. |
| `--remove-orphans` | Removes any container compose does not currently recognise. One typo in a service name and it deletes a running service. |
| `db.dropDatabase()`, `yarn demo:clean`, re-seeding | The demo corpus is production data now. Re-seeding rewrites post ids, which invalidates every URL and every R2 key mapping. |
| `docker system prune -a` | Deletes the *previous* images, which are the rollback. Prune only when `df -h /` is genuinely tight, and never immediately after a deploy. |

A normal deploy stops and recreates **only the services whose code changed**,
which is what `up -d --no-deps <service>` means.

---

## 1. The two commands, and what each one actually does

### `dc build <service>`

Rebuilds that service's image from the current working tree. Nothing running
changes — the new image sits alongside the old one until you recreate the
container. Safe to run at any time; it is the slow half of a deploy.

### `dc up -d --no-deps <service>`

Recreates that one container from the newest image, with the current
`deploy/.env` applied. `--no-deps` is the important half: without it compose
also inspects and may recreate everything the service `depends_on` — for `api`
that is `mongodb` and `redis`, so a routine API deploy would bounce the
database.

The rule that follows:

> **Rebuild changes the image. Recreate applies it.** Neither one alone is a
> deploy: a `build` with no `up` leaves production on the old code, and an `up`
> with no `build` re-runs the old image with new environment values.

---

## 2. What invalidates which image

| You changed | Rebuild | Notes |
|---|---|---|
| `user/**` | `user` | |
| `admin/**` | `admin` | |
| `api/**` | `api` | |
| `file-server/**` | `file-server` | |
| `shared/toast/**` | `user`, `admin` | Yarn v1 **copies** `file:` deps, so the change only lands through a rebuild. |
| `shared/upload-policy/**` | `api`, `file-server`, `user` | The policy registry is read by all three. Grep `@douyin-clone/upload-policy` before assuming otherwise. |
| `deploy/*.Dockerfile` | the service it builds | |
| `deploy/docker-compose.yml` | usually none | Recreate the affected services (§3.G). |
| `deploy/.env` | usually none | Env is applied on **recreate**, not restart — except build args (below). |
| `deploy/nginx/**` | none | Host nginx, not a container: `nginx -t` then `systemctl reload nginx`. |
| `docs/**`, `.agents/**`, `*.md` | none | Nothing to deploy. |

### Build-time values are baked into the Next images

`user` and `admin` receive these as **build args** (see the `args:` blocks in
`deploy/docker-compose.yml`), so they are compiled into the JavaScript the
browser downloads. Changing one in `deploy/.env` and restarting the container
does nothing at all:

| Variable | Consumed by |
|---|---|
| `BASE_URL` → `NEXT_PUBLIC_API_ENDPOINT`, `API_SERVER_ENDPOINT`, `PROXY_API_TARGET` | `user`, `admin` |
| `USER_APP_URL` → `NEXT_PUBLIC_SITE_URL`, `SITE_URL` | `user` |
| `ADMIN_APP_URL` | `admin` (runtime `NEXTAUTH_URL`, but change it with a rebuild anyway — see below) |

**Any change to one of these is `build` + `up`, never `up` alone.**

Runtime-only for the Next apps: `NEXTAUTH_SECRET`, `NEXTAUTH_URL`,
`NEXTAUTH_URL_INTERNAL`. Rotating a secret is a recreate.

For `api` and `file-server` the whole of `deploy/.env` is runtime
(`env_file: [./.env]`), so an env-only change there is `up -d --no-deps` with no
rebuild.

---

## 3. The cases

Each case ends with the verification in [§4](#4-verify-after-every-deploy). Do
not skip it — "the build succeeded" says nothing about whether the container
started.

Every case starts the same way:

```bash
cd ~/short-video-platform
git fetch origin --tags
git checkout <deploy-tag>
git status --short          # expect empty; a dirty tree means the last deploy left something behind
```

### A. Only USER changed

```bash
dc build user
dc up -d --no-deps user
```

### B. Only ADMIN changed

```bash
dc build admin
dc up -d --no-deps admin
```

### C. Only API changed

```bash
dc build api
dc up -d --no-deps api
```

`--no-deps` matters most here: `api` depends on `mongodb` and `redis`, and
omitting it can recreate both.

### D. Only FILE-SERVER changed

```bash
dc build file-server
dc up -d --no-deps file-server
```

Its `file-temp`, `file-tus` and `file-public` volumes survive a recreate. An
upload in flight during the recreate is lost; the TUS client retries.

### E. Multiple services changed

Build **sequentially**, then recreate. On a 2 vCPU / 4 GB VM two concurrent Next
builds is the reliable way to get an OOM-killed build (or, worse, an OOM-killed
`mongod`):

```bash
dc build api
dc build file-server
dc build user            # never in parallel with admin
dc build admin

dc up -d --no-deps api file-server user admin
```

If memory is tight, recreate after each build instead of batching — a container
holding an old image is not costing you anything, but four idle build layers
plus four running services can be.

Watch it while it runs, from a second shell:

```bash
watch -n2 'free -m; docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}"'
```

### F. A `shared/*` package changed

Yarn v1 **copies** `file:` dependencies rather than linking them, and
`yarn install` — even with `--check-files` — reports "already up-to-date" and
skips the re-copy. Inside a Docker build this is not a problem, because the
image installs from scratch; the trap is only local development.

So: rebuild **every consumer** listed in §2, in sequence, then recreate them.

```bash
# example: shared/upload-policy
dc build api
dc build file-server
dc build user
dc up -d --no-deps api file-server user
```

Deploying only some consumers of a shared package is how the client and the
server end up enforcing different limits. If in doubt, rebuild them all.

### G. `deploy/docker-compose.yml`, nginx, or the env contract changed

**Compose file changed.** Read the diff first and identify which services it
touches. Then recreate exactly those:

```bash
dc config                          # renders the file with deploy/.env applied — fails loudly on a missing :? variable
dc up -d --no-deps <changed services>
```

If the change is to a `build.args` block, it is a rebuild as well (§2).
If it adds a new service, `dc up -d <new service>` — still no `--remove-orphans`.

**nginx changed.** nginx runs on the host, not in compose:

```bash
export VM_IP=<static IPv4>
sed "s/__VM_IP__/${VM_IP}/g" deploy/nginx/douyin-clone.conf \
  | sudo tee /etc/nginx/sites-available/douyin-clone >/dev/null
sudo nginx -t                      # never reload without this
sudo systemctl reload nginx        # reload, not restart: no dropped connections
```

Keep the previous file: `sudo cp /etc/nginx/sites-available/douyin-clone{,.bak-$(date +%F)}`
before overwriting. That copy is the nginx half of a rollback.

**`deploy/.env` changed.** Back it up first (it is git-ignored and exists
nowhere else):

```bash
cp deploy/.env deploy/.env.bak-$(date +%F) && chmod 600 deploy/.env.bak-$(date +%F)
$EDITOR deploy/.env
chmod 600 deploy/.env
dc config >/dev/null               # proves nothing required is now missing
```

Then: runtime-only variable → `dc up -d --no-deps <services>`. Build-arg
variable (§2) → `dc build` those services first.

### H. A migration was added

Migrations live in `api/migrations/` and run through `yarn migrate` — they are
**not** run automatically at boot.

```bash
# 1. Back up first. A migration is the one deploy step that can lose data.
dc exec -T mongodb mongodump --username admin --password "$MONGO_ROOT_PASSWORD" \
  --authenticationDatabase admin --archive --gzip > ~/backup-$(date +%F-%H%M).gz
ls -lh ~/backup-*.gz                 # confirm it is not 0 bytes, then copy it OFF the VM

# 2. Ship the code that expects the new shape.
dc build api
dc up -d --no-deps api

# 3. Run the migration inside the running api container.
dc exec api yarn migrate

# 4. Confirm it recorded itself, and that the app still answers.
dc exec api yarn migrate list
curl -fsS http://127.0.0.1:8080/health/ready
```

Order matters and depends on the migration:

- **Additive** (new index, new optional field, settings seed) — deploy the code
  first, as above. The old code ignores what it does not read.
- **Destructive or renaming** — the code must tolerate *both* shapes, or the
  window between step 2 and step 3 serves errors. If it cannot, that is a
  maintenance window, not a routine deploy.

Not every migration is reversible; see the table in
[`README.md` §7](./README.md#7-backup-and-rollback).

### I. Rollback

Rolling back is the same two commands against the previous tag. **It never
touches data**: no volume is removed, no database is reset, and R2 objects are
untouched because media outlives deployments.

```bash
cd ~/short-video-platform
git fetch origin --tags
git checkout <previous-deploy-tag>

dc build <the services you rolled forward>
dc up -d --no-deps <the same services>
```

Faster, when the previous image is still on the VM — no rebuild at all:

```bash
docker images | grep douyin-clone          # find the previous image id
docker tag <old-image-id> douyin-clone-user:latest
dc up -d --no-deps user
```

This is why `docker system prune -a` immediately after a deploy is a bad idea:
it deletes the thing you would roll back to.

What else to roll back, and what not to:

| Component | Rollback | Data safe? |
|---|---|---|
| Application image | previous tag, rebuild + recreate | Yes |
| `deploy/.env` | restore `deploy/.env.bak-<date>`, then recreate | Yes |
| nginx | restore `douyin-clone.bak-<date>`, `nginx -t`, reload | Yes |
| Migration | **Not automatic.** Check the reversibility table before assuming. | Depends |
| R2 objects | Nothing to do — never rolled back | Yes |
| Mongo | Only from a `mongodump` archive, and only as a deliberate restore | — |

An additive migration usually needs no rollback at all: the older code simply
does not read the new field.

---

## 4. Verify after every deploy

Run all of it. Each line answers a different question, and the cheap ones catch
the failures that the expensive ones would misattribute.

### 4.1 The containers

```bash
dc ps
```

Every service `Up`. A service that is `Restarting` is a boot failure — go
straight to the logs. `nest build` succeeding proves nothing about dependency
injection: a provider missing from `appProviders` compiles cleanly and then
fails at boot.

```bash
dc logs --tail=80 <service>
```

For `api` and `file-server` look for `Nest application successfully started`.
For `user` and `admin` look for `Ready in <n>ms`.

### 4.2 Health endpoints

```bash
# API — liveness is public, readiness is loopback-only on purpose (it names
# failing dependencies, which is not something to publish).
curl -fsS https://api.<VM_IP>.sslip.io/health
curl -fsS http://127.0.0.1:8080/health/ready

# file-server
curl -fsS http://127.0.0.1:8000/health
curl -fsS http://127.0.0.1:8000/health/ready
```

### 4.3 Front ends — loopback first, then public

The loopback check isolates the container from nginx and TLS. If loopback
passes and HTTPS does not, the fault is nginx or the certificate, not the
deploy.

```bash
# loopback (on the VM)
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8081/     # user
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8082/auth/login   # admin

# public HTTPS (from anywhere)
curl -fsS -o /dev/null -w '%{http_code} %{time_total}s\n' https://app.<VM_IP>.sslip.io/
curl -fsS -o /dev/null -w '%{http_code} %{time_total}s\n' https://admin.<VM_IP>.sslip.io/auth/login

# the page really rendered, rather than answering 200 with an error shell
curl -fsS https://app.<VM_IP>.sslip.io/ | grep -o '<title>[^<]*</title>'
```

### 4.4 A safe media smoke

Read-only, and it must use a key that already exists — never upload one to test:

```bash
# any object already in the bucket, through the Worker
curl -sI "$R2_PUBLIC_BASE_URL/<an existing video key>"
curl -si -H 'Range: bytes=100-199' "$R2_PUBLIC_BASE_URL/<the same key>" | head -5
# expect 206, Content-Range: bytes 100-199/<size>, Content-Length: 100
```

A `200` where a `206` is expected means the Worker is not honouring Range, and
video seeking is broken even though every page loads.

### 4.5 Resources

```bash
docker stats --no-stream
df -h /
free -m
```

`user` and `admin` are capped at 384 MB each. A container sitting at its limit
will be OOM-killed under load rather than at deploy time, so check this even
when everything looks fine. If `df -h /` is above ~85%, prune **dangling**
images only (`docker image prune`), which keeps the tagged previous images that
are your rollback.

---

## 5. Cheat sheet

```text
ALWAYS FIRST
  cd ~/short-video-platform
  git fetch origin --tags && git checkout <deploy-tag>
  alias dc='docker compose -f deploy/docker-compose.yml --env-file deploy/.env'

USER CHANGE
  dc build user
  dc up -d --no-deps user

ADMIN CHANGE
  dc build admin
  dc up -d --no-deps admin

API CHANGE
  dc build api
  dc up -d --no-deps api

FILE-SERVER CHANGE
  dc build file-server
  dc up -d --no-deps file-server

SEVERAL SERVICES  (build one at a time — never user+admin together)
  dc build api && dc build file-server && dc build user && dc build admin
  dc up -d --no-deps api file-server user admin

SHARED PACKAGE     (rebuild every consumer)
  shared/toast          -> user, admin
  shared/upload-policy  -> api, file-server, user

COMPOSE FILE CHANGED
  dc config                       # validate with deploy/.env applied
  dc up -d --no-deps <changed services>

NGINX CHANGED       (host, not compose)
  sudo cp /etc/nginx/sites-available/douyin-clone{,.bak-$(date +%F)}
  sed "s/__VM_IP__/$VM_IP/g" deploy/nginx/douyin-clone.conf | sudo tee /etc/nginx/sites-available/douyin-clone
  sudo nginx -t && sudo systemctl reload nginx

ENV CHANGED
  cp deploy/.env deploy/.env.bak-$(date +%F) && chmod 600 deploy/.env.bak-$(date +%F)
  runtime var  -> dc up -d --no-deps <services>
  build arg    -> dc build <services> && dc up -d --no-deps <services>
    build args: BASE_URL, USER_APP_URL  (NEXT_PUBLIC_* / API_SERVER_ENDPOINT / PROXY_API_TARGET)

MIGRATION ADDED
  dc exec -T mongodb mongodump --username admin --password "$MONGO_ROOT_PASSWORD" \
    --authenticationDatabase admin --archive --gzip > ~/backup-$(date +%F-%H%M).gz
  dc build api && dc up -d --no-deps api
  dc exec api yarn migrate && dc exec api yarn migrate list

ROLLBACK           (data is never touched)
  git checkout <previous-deploy-tag>
  dc build <services> && dc up -d --no-deps <services>

VERIFY (every time)
  dc ps
  dc logs --tail=80 <service>
  curl -fsS https://api.<VM_IP>.sslip.io/health
  curl -fsS http://127.0.0.1:8080/health/ready
  curl -fsS http://127.0.0.1:8000/health/ready
  curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8081/
  curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8082/auth/login
  curl -fsS -o /dev/null -w '%{http_code}\n' https://app.<VM_IP>.sslip.io/
  curl -fsS -o /dev/null -w '%{http_code}\n' https://admin.<VM_IP>.sslip.io/auth/login
  docker stats --no-stream
  df -h /

NEVER, during a code deploy
  docker compose down            docker volume rm / down -v
  --remove-orphans               database reset / re-seed / demo:clean
  docker system prune -a         (it deletes your rollback)
```
