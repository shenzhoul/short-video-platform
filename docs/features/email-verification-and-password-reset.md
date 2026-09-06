---
title: Email Verification and Password Reset
description: Confirming an email address before an account can log in, recovering a forgotten password, and the Gmail SMTP setup behind both.
audience: [user, admin, operator, developer-agent]
domain: identity
status: active
updated: 2026-08-28
tags: [email, verification, password-reset, smtp, gmail, tokens]
---

# Email Verification and Password Reset

Added 2026-08-27. Before this, `verifiedEmail` was a flag an administrator set by
hand and nothing sent or checked a confirmation email; there was no password
recovery of any kind.

## For a visitor

### Signing up

1. Fill in the signup pane of the login dialog.
2. The account is created and the dialog switches to **Check your email**. No
   session is created and you are not signed in.
3. Open the link in the email. It goes to `/auth/verify-email` and confirms the
   address.
4. Press **Log in**.

The link is good for **24 hours** and works once. If nothing arrives, the
check-your-email screen has a **Send the link again** button with a 60-second
cooldown; check the spam folder first, since the message comes from an address
you have never written to.

### Trying to log in before confirming

The password is checked first. If it is correct but the address is unconfirmed,
the dialog says so and offers the same Resend control. **No session is created** —
the refusal happens before any token is issued.

A *wrong* password gets the ordinary "your username/email or password is
incorrect", exactly as before. Nothing about an account's confirmation state is
visible to somebody who has not proved they hold its password.

### Forgetting a password

1. **Forgot password?** on the login pane.
2. Enter the address you signed up with.
3. The screen always says the same thing — "if that address has an account, a
   link is on its way" — whether or not it is registered.
4. Open the link, choose a new password, press **Log in**.

The reset link is good for **one hour** and works once. Completing a reset signs
you out everywhere and does **not** sign you back in.

An account whose address is still unconfirmed **does** get reset emails, and
resetting the password does not confirm the address — those are two separate
things. After the reset, logging in still asks for confirmation first.

## For an administrator

### Creating a user

**Users → Create New User** has a **Verified Email** switch, and it now decides
whether the person gets an email:

| Switch | `verifiedEmail` | Email sent | Can log in |
|---|---|---|---|
| Off (default) | `false` | Yes, a confirmation link | Only after they follow it |
| On | `true` | No | Immediately |

Turning it on means *you* are vouching for the address. Leave it off and the
account behaves exactly like a self-registered one.

The success message tells you which happened. If it says the confirmation email
could not be sent, the **account still exists and is correct** — only the mail
failed. The person can request a fresh link from the login screen.

An account created unconfirmed must have an email address. The API refuses to
create one without: an account that must confirm an address it does not have can
never log in and can never be mailed.

### Changing a user's email

`PUT /admin/users/:id` resets `verifiedEmail` to `false` when the address really
changes, and then does three things so the person is not silently locked out:

1. supersedes the confirmation links issued for the **previous** address;
2. **revokes their live sessions** — login now refuses the account, so a session
   minted before the change would be a claim outliving the check that granted it;
3. mails a fresh confirmation link to the **new** address, never the old one.

"Really changes" means the *normalised* value differs. Re-submitting the same
address with different capitalisation or surrounding whitespace is not a change
and leaves the confirmation alone. (Until 2026-08-28 the comparison was between
the raw payload and the already-lowercased stored value, so a case-only edit
unset `verifiedEmail` and locked the account out of a login it was entitled to.)

Ticking **Verified Email** in the same edit is respected: the administrator is
vouching for the new address, so no mail is sent, no sessions are revoked, and
nothing later in the update turns the flag back to `false`.

The self-service profile update cannot change an address at all —
`CreatorSelfUpdatePayload` declares no `email` field, and a test pins that.

### Recovering an administrator's own password

Unchanged, and deliberately so: `admin/` has no forgot-password page. Another
administrator uses **Users → Update → Password**, or somebody runs
`node api/scripts/reset-admin-pw.js` on the server.

## For an operator

### Environment

All mail configuration lives in the **API's** environment and nowhere else. It is
never in the database, never in the admin UI, never returned by an API, and never
prefixed `NEXT_PUBLIC_` — that prefix inlines a value into the browser bundle,
which for an SMTP password means publishing it.

```env
MAIL_PROVIDER=smtp                 # 'log' locally; 'smtp' is required in production
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false                  # 587 is STARTTLS; only 465 uses SMTP_SECURE=true
SMTP_USER=<dedicated-demo-gmail>
SMTP_PASS=<gmail-app-password>
MAIL_FROM_NAME=Douyin Clone
MAIL_FROM_ADDRESS=<same-dedicated-demo-gmail>
USER_APP_URL=https://<user-app-public-origin>
EMAIL_VERIFICATION_TOKEN_TTL_MINUTES=1440
PASSWORD_RESET_TOKEN_TTL_MINUTES=60
```

The API **refuses to start** if any of these is missing or contradictory when
`MAIL_PROVIDER=smtp`, and the message names the variable. It also refuses to
start with `MAIL_PROVIDER=log` under `NODE_ENV=production`: a production process
that cannot reach SMTP must not quietly start printing verification links to
stdout instead.

### Setting up the Gmail account

Use a Gmail account created for this project. Do not use a personal address — the
password below can send mail as that account.

1. Sign in to the project Gmail account.
2. Turn on **2-Step Verification** (App Passwords are unavailable without it).
3. Create an **App Password**: <https://support.google.com/accounts/answer/185833>.
   It is 16 characters; paste it without spaces.
4. Put it in the API host's secret store as `SMTP_PASS`. Never commit it.
5. Set `MAIL_FROM_ADDRESS` to the same address. Gmail rewrites a `From` that does
   not match the authenticated account, so a different value achieves nothing.

**Limits.** A free Gmail account allows roughly 500 recipients a day over SMTP and
will throttle or lock an account whose traffic looks abusive. That is ample for a
demo, and it is why the cooldowns below matter.

### Local development

`MAIL_PROVIDER=log` prints each message to the server console and sends nothing,
so no Gmail account is needed to develop or to run the tests. The link's query
string is **redacted** by default, because a raw token in a log file is a live
credential in a log file. Set `MAIL_LOG_REVEAL_LINKS=true` to print the clickable
link; it is ignored under `NODE_ENV=production`.

`USER_APP_URL` is required even locally — every emailed link is built from it and
from nothing else. It is never derived from a request's `Host` or `Origin`
header, because those are attacker-controlled and a reset link built from one is
a credential-harvesting link on somebody else's domain. That also means any
non-production build emails the production URL; there is one canonical value.

### Deployment shape

The API needs an **always-on** host: it holds a Socket.IO gateway, resident
BullMQ workers, Redis sessions and a pooled Mongo connection. In production all
four applications are containers on one VM behind nginx, so this is satisfied by
construction — see [deployment](../deployment/README.md).

On a host that **sleeps when idle** (Render's free tier), a mail job enqueued
just before the process suspends is not processed until the next request wakes
it. Retries drain it eventually, but "eventually" is not a promise a signup
screen can make — which is why every screen that waits on an email carries a
Resend control rather than treating the first send as final.

## For a developer

### The token model

One collection, `auth_tokens`, discriminated by `type`
(`email-verification` / `password-reset`).

- 256 bits from `crypto.randomBytes(32)`, `base64url`. Never `Math.random()`.
- Only `sha256(raw)` is stored. The raw token exists in the email body and in the
  incoming request, nowhere else.
- SHA-256 rather than scrypt on purpose: a KDF's cost defends a *low-entropy*
  secret, and there is nothing to guess in 256 random bits. Making the lookup
  expensive would just hand an attacker a way to burn CPU.
- **Several tokens may be active at once.** "One per user" has a race with no
  good answer — two resends, two emails, one overwritten row, and the first
  recipient holds a link that silently does nothing.
- The claim is one statement, and it is both the validity check and the
  consumption:

```js
findOneAndUpdate(
  { tokenHash, type, status: 'active', expiresAt: { $gt: new Date() } },
  { $set: { status: 'consumed', resolvedAt: new Date() } },
  { returnDocument: 'before' }
)
```

  `null` means unknown, expired, superseded **or** already used — one error code
  for all four. A successful claim then supersedes the account's remaining tokens
  of that type.
- The TTL index is `{ expiresAt: 1 }` with **`expireAfterSeconds: 0`**, because
  `expiresAt` is an absolute instant: MongoDB deletes the row once that instant
  has passed. (It shipped as `604800`, which is the option for a *creation*
  timestamp and meant "keep spent tokens for a week"; corrected 2026-08-28 by
  `scripts/repair-auth-token-ttl-index.js`.)
- The TTL index is housekeeping **only**. Expiry is enforced by the predicate
  above, because the TTL monitor runs about once a minute with no ordering
  guarantee — `verify-auth-tokens.js` proves it by backdating a row and showing
  the claim refuses it while the row is still present.

### Failure behaviour, without transactions

MongoDB here is standalone, so each sequence is ordered such that its failure
lands somewhere recoverable, and **no step reports success unless the mutation it
describes became the final state**.

| Step fails | What happens |
|---|---|
| User document write | Nothing was created. Error to the client. |
| Credential write | The **user document is deleted first**, then the credential. |
| Token or mail | Account stands, unconfirmed, with Resend available. Never rolled back. |
| `verifiedEmail` write after a claim | Claim is **released**; the link still works. |
| `replaceAuthPassword` after a claim | Claim is **released**; the link still works. |
| Session revocation after a reset | Password **stays changed** and the call still succeeds. Logged at error level; old sessions expire on their own TTL. |
| Superseding siblings | Ignored. They expire on their own. |

**Compensation deletes the user before the credential**, and the order is the
point. A crash between the two deletes can only strand a credential whose
`userId` no longer exists — harmless, because it holds no email or username and
blocks nothing. The reverse order could strand a *user with no credential*, which
is the original bug: login answers "invalid credentials" for ever while
re-registration answers "that email is taken", so the address is permanently
unusable.

This is best-effort, not a transaction and not crash-proof.
`scripts/audit-incomplete-accounts.js` is the other half — it finds both leftover
shapes, removes only the unambiguous one (orphan credentials), and reports users
with no credential for a human, because that shape is indistinguishable from an
account an administrator deliberately created without a password.

The residual window is a crash between the credential write and the session
revocation: the password is new and old sessions survive until they expire.

### Rate limits

Two layers. IP, via `CustomThrottlerGuard` (Redis-backed, cluster-safe), and
per-identifier, via `AuthRateLimitService` — keyed on `sha256(identifier)` so the
address never becomes a Redis key, with an explicit TTL on every key.

| Route | Per IP | Per identifier |
|---|---|---|
| `POST /auth/register` | 5 / 5 min | — |
| `POST /auth/login` | 5 / min | — |
| `POST /auth/verification/resend` | 5 / hour | 60 s cooldown, 5 / 24 h |
| `POST /auth/forgot-password` | 5 / hour | 60 s cooldown, 5 / 24 h |
| `POST /auth/verify-email` | 20 / hour | — |
| `POST /auth/reset-password` | 10 / hour | — |

A per-identifier refusal is **silent**: the endpoint returns its usual generic
200. A rate limit that is observable per address is itself an oracle for "this
address is registered".

**The limiter fails closed for mail dispatch** (changed 2026-08-28). If Redis
cannot report the rate-limit state, no mail goes out. It is the only thing
bounding how many messages one Gmail account sends, and Gmail throttles then
locks a sender whose traffic looks abusive — so failing open would turn "Redis is
down" into "the send limit is off", exactly when an attacker would want it off,
and the damage is not self-correcting: a locked sender stays locked long after
Redis recovers. Failing closed costs a delayed email. Nothing a caller can
observe changes either way.

`consume()` returns `allowed` / `limited` / `unavailable`;
`consumeForMailDispatch()` is the wrapper that treats the third as "no". The
outage is logged as a structured warning carrying the action, a 12-character hash
prefix and the error's *name and code* — never the address and never
`error.message`, which for an ioredis connection failure can contain the host,
port and credential.

### Why the confirmation link is a GET to a page, not to the API

The mailed link opens `/auth/verify-email?token=…`; the page then POSTs the
token. Gmail and most security appliances fetch the URLs in a message to scan
them, so a GET that consumed the token would be spent by the scanner before the
recipient ever clicked. It also keeps the token out of the API access log and out
of any `Referer` the page emits.

## Main implementation

| Concern | File |
|---|---|
| Config + boot validation | `api/src/config/mailer.ts`, `api/src/services/shared/mailer/mail-config.service.ts` |
| Transports | `smtp-mail.provider.ts`, `log-mail.provider.ts`, `mail-provider.factory.ts` |
| Queue | `api/src/services/shared/mailer/mailer.service.ts` |
| Templates | `api/src/templates/emails/` |
| Tokens | `api/src/schemas/identity/auth/auth-token.schema.ts`, `api/src/services/identity/auth/auth-token.service.ts` |
| Flows | `email-verification.service.ts`, `password-recovery.service.ts`, `auth-mail.service.ts` |
| Limits | `api/src/services/identity/auth/auth-rate-limit.service.ts` |
| Routes | `api/src/controllers/identity/auth/verification.controller.ts`, `password-recovery.controller.ts` |
| Enforcement | `api/src/services/identity/auth/auth.service.ts` (`login`), `api/src/common/lib/email-verification.lib.ts` |
| Registration + compensation | `api/src/services/identity/user/user.service.ts` |
| Migration | `api/migrations/1787800000000-auth-token-indexes.js` |
| Cleanup job | `api/src/jobs/identity/cleanup-auth-tokens.job.ts` |
| Dialog panes | `user/src/components/auth/auth-forgot-form.tsx`, `auth-verification-notice.tsx`, `auth-resend-verification.tsx` |
| Public pages | `user/src/app/auth/verify-email/`, `user/src/app/auth/reset-password/` |
| Error propagation | `user/src/lib/auth-options.ts` (`AUTH_ERROR_CODES`) |
| Redis namespacing | `api/src/kernel/infras/redis/redis-keys.ts` |
| Live probe (disposable DB) | `api/scripts/verify-auth-tokens.js` |
| Repair / audit | `api/scripts/audit-incomplete-accounts.js`, `repair-auth-token-ttl-index.js` |
| Probes for those | `api/scripts/verify-account-repair.js`, `verify-redis-namespace.js` |

## Redis namespacing (added 2026-08-28)

Every key this application writes lives under `douyin-clone:`. The development
Redis is shared with another project, so a bare key named no owner and cleaning
up after a test meant matching on shape and hoping.

| Group | Mechanism | Example |
|---|---|---|
| Sessions, cache, presence, coalescers, share guard, mail cooldowns | explicit prefix via `REDIS_KEYS` | `douyin-clone:session:<uid>:<token>` |
| NestJS throttler | ioredis `keyPrefix` on its own client | `douyin-clone:throttle:{<hash>:default}:hits` |
| BullMQ | its own `prefix` option | `{douyin-clone-<queue-hash>}:…` |
| Socket.IO adapter | the adapter's `key` option | `douyin-clone:socket.io#…` |

**Not a blanket `keyPrefix`.** ioredis applies `keyPrefix` to key *arguments* but
**not** to the pattern given to `KEYS`/`SCAN`, and `TokenService` finds sessions
by pattern — so a blanket prefix would store `douyin-clone:auth:token:…` and then
search for `auth:token:…`, matching nothing. Every login would succeed and every
following request would 401. Verified rather than assumed. `keyPrefix` is used in
exactly one place, the throttler's client, because that library addresses its
counters only through `EVAL`, whose key arguments *are* prefixed.

Adding the namespace is a one-way **cutover**: dev sessions, the settings cache,
presence sets and coalescer sets start empty. Old un-namespaced keys are left
alone — they carry TTLs or are rebuilt on demand, and deleting un-namespaced keys
in a shared Redis is the thing this exists to stop. On Upstash, give the project
its own database as well.

## Boundaries

- No CAPTCHA. If the public demo gets spammed, Cloudflare Turnstile on
  `register` and `forgot-password` is the smallest addition; nothing depends on
  it today.
- No self-service "change my password while signed in" route. The reset flow and
  the admin route are the only two ways a password changes.
- No admin-side recovery UI. See `docs/features/authentication.md`.
- Templates are TypeScript functions, not database rows. There is no template
  editor and no generic "send an email" endpoint — two named use cases, both
  taking their recipient from a user document the server looked up.
