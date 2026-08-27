---
title: Credentials Authentication
description: Login and signup dialog on the user web app, admin login page, session and logout behavior.
audience: [user, admin, developer-agent]
domain: identity
status: active
updated: 2026-08-26
tags: [authentication, nextauth, session, registration, modal, scrypt]
---

# Credentials Authentication

## User app — the auth dialog (updated 2026-08-26)

There is no login **page** in the user app any more. Everything that needs an
account opens one shared dialog over whatever the visitor is already looking at,
so the URL never changes and their place in the feed is never lost.

### Guest flow

1. The visitor triggers something that needs an account — like, comment, follow,
   share, message, publish, or a member-only route.
2. The action is blocked and the auth dialog opens. The address bar does not
   change.
3. The dialog opens in **login** mode: a decorative QR panel on the left
   (desktop only) and a username/password form on the right. The `Sign up` link
   switches the same dialog to signup mode.
4. Signing in or signing up closes the dialog and re-renders the current route in
   place. No full page reload.
5. Closing the dialog without signing in leaves the visitor exactly where they
   were — unless they were on a member-only route, in which case they are
   returned to the home page with `replace` so Back does not walk into it again.

Nothing is replayed after signing in. The like or follow that opened the dialog
is **not** re-issued, because a queued write firing later is how one tap becomes
two. The visitor simply presses it again.

### Signing up

Public self-registration is open to anyone. The signup pane asks for first name,
last name, username, display name, email, gender, password and password
confirmation — the same fields and the same validation rules as the admin
create-user form (`admin/src/components/user/account-form.tsx`), so an account a
visitor makes for themselves is the same kind of record an administrator makes
for them.

The client never chooses role, status or any internal flag. `RegisterPayload` is
an explicit **allow-list** of exactly seven fields — `firstName`, `lastName`,
`name`, `username`, `gender`, `email`, `password` — built with `PickType` so a
field added to the shared `UserCreatePayload` later cannot join the public API by
accident. The controller validates it with `whitelist: true`, which strips
anything else before the handler runs (this repo uses `whitelist` without
`forbidNonWhitelisted`, so extra fields are dropped rather than rejected), and
`registerNewUser` then assigns `isAdmin: false`, `status: active`,
`verifiedEmail: false` itself.

A duplicate email or username is reported against that field in the form. Every
other failure is one toast. A failed login is always the single message
`Your username/email or password is incorrect` — the API's own wording (which
distinguishes "no such account" from "wrong password") is never forwarded.

### QR login

The QR panel is a **fixed decorative asset** (`user/public/login-qr-placeholder.svg`)
and is labelled "Coming soon — scan login is still in development". It calls no
API, polls nothing, and cannot put the app into a signed-in state. Real QR
authentication is not implemented.

### `/auth/login` and `/auth/forgot-password`

Both are retired. The proxy (`user/src/proxy.ts`) redirects them to
`/?authModal=login`, which opens the dialog on the home page and then strips the
parameter. A signed-in visitor is redirected to `/` with no dialog.

`/auth/forgot-password` never had a page. Audited 2026-08-26: no such route ever
existed in the user app, the old login page's "Forgot password?" link resolved to
not-found, and the API has never exposed a recovery endpoint (`POST /auth/forgot`
answers 404). The redirect therefore replaces a dead link and removes nothing.

### No password recovery

There is no self-service password reset for users, and the dialog deliberately
shows no "Forgot password?" link — advertising a flow that does not exist is
worse than omitting it. Changing a password is currently only possible through
the admin route `PUT /admin/auth/user/password`. (The admin app's own
`/auth/forgot` page posts to the missing endpoint and misreports the 404; tracked
as `bug-admin-forgot-password-posts-to-missing-endpoint`.)

## Protected pages (updated 2026-08-26)

A page whose data needs a session checks `getServerSession` **before** it fetches
anything, and renders `AuthRequiredGate` when there is none. Nothing private goes
on the wire, nothing private reaches the browser, and the URL the visitor asked
for is preserved while the dialog is open. Signing in refreshes the route in
place.

| Route | Signed out |
|---|---|
| `/following` | gate + dialog over `/following` (was: HTTP 200 with an empty feed that looked like "you follow nobody") |
| `/friend` | gate + dialog over `/friend` (was: HTTP 404 — the route did not exist) |
| `/messages` | gate + dialog |
| `/creator/publish`, `/creator/publish/video`, `/creator/publish/image` | gate + dialog |
| `/creator/posts`, `/creator/posts/[id]/edit` | gate + dialog |
| `/`, `/for-you`, `/search`, `/[creator]` | public, unchanged |

The three failure states are kept apart everywhere. `401` is never reported as
`404`: on a public creator profile a rejected credential means a stale session,
not a missing person, so it is rethrown for the error boundary. `403` keeps its
own forbidden view, `410` its account-unavailable view, and `404` is reserved for
a resource that genuinely does not exist.

The Profile entry in the left navigation builds its href from the signed-in user,
so signed out it used to interpolate to `/undefined` and 404. It now opens the
dialog instead of navigating.

**Known dead link:** `/minigame` is in the navigation but was never built and
404s for signed-in users too. Tracked as
`bug-user-friend-and-minigame-nav-links-have-no-route`.

## Password storage (updated 2026-08-26)

Passwords are hashed with **scrypt** (`node:crypto`, RFC 7914), owned entirely by
`PasswordHasherService`. Nothing else hashes, compares, or decides what a stored
credential means.

```text
scrypt$v=1$N=32768,r=8,p=1$<salt-base64>$<derived-key-base64>
```

Parameters travel with each hash, so raising the cost later does not invalidate
existing credentials. Comparison is `timingSafeEqual`. A malformed or
unsupported credential fails as invalid credentials, never as a 500.

The previous scheme was a single salted SHA256 round. **Nobody is asked to reset
a password**: a legacy credential is verified with the old algorithm at login
and, only on success, re-hashed with scrypt through a compare-and-set on
`{_id, value, salt}` — so a concurrent login or password change is never
overwritten, and a failed upgrade is logged rather than failing the login.

### Creating vs replacing a credential

The two are separate operations with separate MongoDB documents, because
conflating them produces false successes:

| Operation | MongoDB | On conflict |
|---|---|---|
| `createAuthPassword` | `findOneAndUpdate({userId, type}, { $setOnInsert: {...} }, { upsert: true, new: false })` | credential exists with a *different* password → `CredentialAlreadyExistsException` (409); same password → idempotent success |
| `replaceAuthPassword` | `findOneAndUpdate({userId, type}, { $set: { value, key }, $unset: { salt } }, { new: true })` — **no upsert** | nothing to replace → `CredentialNotFoundException` (404) |
| `setAuthPassword` | replace, falling back to create only on `CredentialNotFoundException` | the entry point for a password change |

`create` used `$set` on an upsert until 2026-08-26, which made it
indistinguishable from a change: two concurrent creates with different passwords
both reported success while only one password survived, so one caller was told
their password was saved for an account that would reject it.

Concurrent *changes* are last-write-wins and observably so — one row, the old
password stops working, and exactly one of the two new passwords is the stored
credential. A password change has no expected previous value to compare against,
so compare-and-set does not apply; the lazy legacy upgrade, which *does* have
one, still uses it.

`AuthDto` exposes neither the hash nor the salt.

The `auth` collection has a unique index on `{ userId, type }`. Duplicates in an existing
database are cleared by
`node api/scripts/repair-auth-credential-duplicates.js --apply` (dry-run by
default).

There is still no password reset. See "No password recovery" above.

## Admin app

The admin app keeps its dedicated `/auth/login` page and its own NextAuth
credentials configuration.

Its `/auth/forgot` page was **removed** on 2026-08-26 — it posted to
`POST /auth/forgot`, a route the API has never implemented, and rendered the 404
as "Account not found, please recheck the email". The route now redirects to
`/auth/login`. Recovery for an administrator is another admin using
`PUT /admin/auth/user/password`, or `api/scripts/reset-admin-pw.js`.

`PUT /admin/auth/user/password` (admin password change) was written and guarded
but never listed in `appControllers`, so it answered 404 until 2026-08-26. It is
registered now; a non-admin caller still gets 403.

Admin create-user persists the status the administrator chooses (active,
inactive, under-review, deleted). It used to be discarded and every account came
out active. The status is forwarded from the controller as a typed
`CreateAccountIntent`; the service still ignores any status left in a request
body, which is what keeps public registration unable to choose one.

## API flow

1. `POST /auth/login` — validates the password credential and account status,
   returns the API token and profile. Rate limited to 5 attempts per minute.
2. `POST /auth/register` — public self-registration, rate limited to 5 attempts
   per 5 minutes. Returns the created profile and **no session**; the client then
   signs in through `POST /auth/login`, so session issuance stays in one place.
3. `POST /admin/users` — unchanged, still behind `@Roles('admin')` and
   `RoleGuard`, still accepting the admin-only fields (status, verified email).
4. NextAuth stores the token/session fields used by the server and browser API
   clients.
5. Logout calls the API logout endpoint and clears the web session.

Registration and admin creation both run through
`UserAccountManagementService.createNewUserAccount`, so uniqueness, email/username
normalisation, password hashing and the account-created event have one
implementation. Concurrent registrations for the same identity are settled by the
`idx_email_unique_auth` / `idx_username_unique_profile` unique indexes; the loser
gets a normalised "already registered" 400 rather than a raw driver error.

Verified against a real database on 2026-08-26 with
`node api/scripts/verify-registration-concurrency.js`, which creates a disposable
database, builds the real indexes, and races two `registerNewUser` calls: one
user document, one auth document, no orphans, for same-email, same-username and
identical payloads. A live HTTP probe cannot show this — the throttler rejects
the second request before it reaches the database.

## Main implementation

- API controllers: `api/src/controllers/identity/auth/login.controller.ts`,
  `register.controller.ts`, `logout.controller.ts`
- API payload: `api/src/payloads/identity/auth/register.payload.ts`
- API service: `api/src/services/identity/auth/auth.service.ts`,
  `api/src/services/identity/user/user.service.ts` (`registerNewUser`)
- Password hashing: `api/src/services/identity/auth/password-hasher.service.ts`
- User app route guard usage: `user/src/app/(public)/(main)/following/page.tsx`
- Verification scripts: `api/scripts/verify-registration-concurrency.js`,
  `verify-password-migration.js`, `verify-auth-credential-uniqueness.js`,
  `repair-auth-credential-duplicates.js`, `admin/scripts/verify-auth-ui.js`
- User app dialog: `user/src/providers/auth-modal.provider.tsx`,
  `user/src/components/auth/auth-modal.tsx`, `auth-login-form.tsx`,
  `auth-signup-form.tsx`, `auth-qr-panel.tsx`, `auth-fields.tsx`
- User app route guard: `user/src/components/auth/auth-required-gate.tsx`
- User app session: `user/src/lib/auth-options.ts`, `user/src/proxy.ts`
- Admin app: `admin/src/lib/auth-options.ts`, `admin/src/components/auth/login-form.tsx`

## Boundaries

- User and admin NextAuth configurations use credentials providers only.
- QR login, phone login, OTP, social login, password reset, email verification
  and CAPTCHA are **not** shipped. `AuthService` has no `forgot()` method and the
  API has no forgot/reset route — an earlier JSDoc example claimed otherwise and
  has been corrected.
- The existing OAuth callback page is a utility route, not evidence of an enabled
  provider.
- No admin configuration is required to enable signup; it is open by default.
