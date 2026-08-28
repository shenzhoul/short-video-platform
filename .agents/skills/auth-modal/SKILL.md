---
name: auth-modal
description: The shared login/signup dialog in the Douyin Clone user app and the public registration endpoint behind it. Use when gating an action or route behind authentication, adding an auth entry point, changing signup fields or validation, or touching /auth/register, RegisterPayload, or registerNewUser.
---

# Auth Modal and Public Registration

Read `docs/features/authentication.md` first for the product rules. This file is
the implementation detail that is easy to get wrong.

## When to Apply

- Gating any action or route behind a signed-in account in `user/`
- Adding or changing an auth entry point (a "Log in" control anywhere)
- Changing signup fields, validation, or what registration assigns
- Touching `POST /auth/register`, `RegisterPayload`, or
  `UserAccountManagementService.registerNewUser`
- Anything that made you reach for `/auth/login`

---

## 1. There is no login page in `user/`. Never navigate to one

`user/src/app/auth/login/` and `components/auth/login-form.tsx` were deleted on
2026-08-26. `user/src/proxy.ts` redirects `/auth/login` and
`/auth/forgot-password` to `/?authModal=login`.

Gating an **action**:

```ts
const { openAuthModal } = useAuthModal();   // @providers/auth-modal.provider

if (!loggedIn) {
  openAuthModal();   // blocked; the dialog is the feedback
  return;
}
```

Do **not** also fire a toast. Opening the dialog and telling the visitor off are
the same message twice.

Gating a **route** — in the server component, before anything private is
fetched:

```tsx
const session = await getServerSession(authOptions);
if (!session) return <AuthRequiredGate />;   // never redirect('/auth/login')
```

The URL the visitor asked for is the thing being preserved. An edge redirect in
`proxy.ts` would throw it away before the page could decide, which is why
private routes are no longer intercepted there.

## 1b. A protected *data* page gates before it fetches

Not just the routes that are obviously private. Any page whose data needs a
session must check first:

```tsx
const { session, token } = await getServerAuth();
if (!session || !token) return <AuthRequiredGate />;   // no fetch above this line
```

`/following` used to skip the fetch when there was no token and render the feed
anyway — HTTP 200 with an empty feed, which reads as "you follow nobody" rather
than "you are not signed in". An empty state whose real cause is a missing
session is the same bug as a 404 whose real cause is a missing session.

**Keep 401, 403 and 404 apart.** They have different remedies, and a shared
`catch` that ends in `notFound()` erases the difference — on the public creator
profile that told a signed-in visitor with a stale token that the person had
vanished. 401 is rethrown for the error boundary, 403 keeps its forbidden view,
410 its account-unavailable view, 404 means the resource genuinely is not there.

**A menu href built from the user needs the same care.** Profile was
`` `/${user?.username}` ``, which signed out is the literal `/undefined` and a
hard 404. Items like that carry `requiresSignedInHref` and open the dialog
instead of navigating. A fixed URL like `/following` should navigate — the gate
preserves it, which is better.

**Do not gate a route that does not exist.** Gating a route with no page makes
signing in lead to the same 404. `/friend` was in that state and was *built*
rather than gated or hidden — see `docs/features/authentication.md`; "friend"
means mutual follow, reusing `FollowService` and `FollowingFeed` rather than a
parallel system. `/minigame` is still unbuilt and still 404s for everyone.

## 1c. There is no logout page either. Use `useLogout`

`user/src/app/auth/logout/` and `components/auth/logout.tsx` were deleted on
2026-08-26. Signing out is:

```ts
const { logout, loggingOut } = useLogout();   // @hooks/use-logout
```

It revokes first (`performLogout` → NextAuth `signOut` → the `signOut` event
revokes the API token), then `router.replace('/')` and `router.refresh()`.
`replace` so Back cannot return to the protected page; `/` so a route guard does
not reopen the dialog the instant the visitor logs out; `refresh` so the server
tree and RSC cache come back signed-out. No `window.location.href`.

**A failed revoke must not navigate.** Showing a signed-out page while the
session is live on the server is worse than an error toast.

For the *involuntary* case — a 401, a deactivated account, a socket disconnect —
use `endExpiredSession` (`@lib/session-expired`). It does the same revoke but
finishes with `window.location.replace('/')`, because it runs from modules with
no router and the client cache is stale anyway. It de-duplicates, so several
simultaneous 401s produce one sign-out.

**`/auth/logout` redirects to `/` and performs no logout.** The old page ran
`signOut()` in a `useEffect`, which made a GET a state change — a prefetch or an
`<img src>` could sign somebody out. Keep logout on the POST path.

`retired-auth-pages.spec.ts` fails the build if either page or any navigation to
them comes back.

## 2. One dialog, mounted once

`AuthModalProvider` lives in `user/src/app/layout.tsx`, inside
`MainLayoutProvider` (it reads the site name and logo) and above the page. It is
the only thing that renders `AuthModal`. A feature that mounts its own copy
breaks the "one dialog at a time" guarantee, which currently costs nothing to
maintain because it is structural.

## 3. `reason` decides what closing means

- `openAuthModal()` — an action. The page behind is real; closing is closing.
- `openAuthModal({ reason: 'route' })` — a route guard, and **only** a route
  guard. Closing without signing in does `router.replace('/')`, because there is
  nothing behind the dialog and a `push` would let Back walk into the empty
  route and reopen it for ever.

## 4. Three auth states, not two

`AuthRequiredGate` distinguishes `loading` / `authenticated` / `unauthenticated`.
Opening the dialog while the session is still `loading` flashes a login form at
somebody who is already signed in, on every hard refresh of every protected
page. When the client is authenticated but the server render was not, it calls
`router.refresh()` **once** — guarded by a ref, because refresh re-renders the
same tree and a server that still says no would otherwise loop.

## 5. Never replay the action that opened the dialog

Signing in must not re-issue the like, follow, comment, share or message the
visitor pressed while signed out. A queued write that fires later is how one tap
becomes two comments. The visitor presses it again, once, now signed in.

## 6. Signing in refreshes; it never reloads

`signIn('credentials', { redirect: false })` has already refreshed the NextAuth
session by the time it resolves, so the provider's `status === 'authenticated'`
effect closes the dialog and calls `router.refresh()`. That re-runs the server
component with the new cookie — the gate is replaced by the real page — while
scroll position, open panels and half-typed text survive. The old login page did
`window.location.href = ...`; do not go back to that.

## 7. One failure, one toast, and never the server's wording

A failed sign-in is always `Your username/email or password is incorrect`
(exported as `LOGIN_FAILED_MESSAGE`), on a fixed `toastId` so repeats collapse.
The API distinguishes "no such account" from "wrong password" from "account
inactive"; forwarding that difference tells an attacker which usernames exist.

In signup, a taken email or username is set as an **inline field error** and no
toast. Everything else is one toast. Never both for the same failure.

Guard every post-await write with the form's `activeRef`: the dialog unmounts
the moment the session turns authenticated, and switching modes unmounts the
form too.

## 7b. Email confirmation and recovery (added 2026-08-27)

This section used to say "there is no password recovery, do not link to one".
The flow now exists. Read
`docs/features/email-verification-and-password-reset.md` for the whole design;
what follows is what the dialog specifically has to get right.

**Registration issues no session and the client must not try to make one.**
`registerNewUser` hard-codes `verifiedEmail: false` and `POST /auth/login`
refuses an unconfirmed account, so the `signIn()` that used to follow
registration is now a guaranteed failure dressed up as an error. The signup pane
switches to a check-your-email state instead.

**`EMAIL_VERIFICATION_REQUIRED` is the only API error code the browser sees.**
`authorize()` in `user/src/lib/auth-options.ts` forwards it through an
allow-list (`AUTH_ERROR_CODES`) and collapses everything else into
`LOGIN_FAILED_MESSAGE`. The API distinguishes "no such account" from "wrong
password"; passing that difference to the browser would tell an attacker which
usernames exist. It is safe to be specific about *this* one because the API only
returns it **after** verifying the password.

**Never claim an email was sent.** `POST /auth/verification/resend` and
`POST /auth/forgot-password` answer the same 200 for a registered address, an
unregistered one, an already-confirmed one and one inside its cooldown. So the UI
says "if that account still needs confirming…" and "if that address has an
account…". A 429 is folded into the same success state, because a visible
per-address rate limit is itself an enumeration signal. Only a transport failure
gets its own wording.

**One resend control, not three.** `auth-resend-verification.tsx` is shared by
the signup pane, the login pane's unconfirmed state and the expired-link page, so
there is one cooldown rule and one piece of copy. Its timer is a courtesy; the
server enforces the real limit and refuses silently.

**`forgot` is a provider mode; check-your-email is not.** `AuthModalMode` gained
`'forgot'` because it is a genuine third pane with its own form and endpoint. The
narrower states belong to a single submission of a single form and stay in that
form's local state — lifting them would make the provider carry state only that
form can produce or clear. `?authModal=forgot` is deliberately **not** accepted
from the URL: a link that opens a password-reset pane is a link worth putting in
a phishing email.

**The two public token pages must never be gated.** `/auth/verify-email` and
`/auth/reset-password` are reached from an email by somebody who by definition
cannot sign in. They live under `user/src/app/auth/` (outside
`(public)/(main)`, so no `AuthRequiredGate`), they are listed in
`publicTokenPaths` in `user/src/proxy.ts`, and `proxy.spec.ts` asserts they pass
through **signed in and signed out**. Do not confuse `/auth/reset-password` (a
real page) with `/auth/forgot-password` (a retired URL that is redirected).

**Neither page opens the dialog before it has handled its token.** A login form
over a verification result asks somebody to sign in to read an answer about the
account they cannot sign in to yet. The dialog is offered afterwards, as a next
step — and success never auto-logs-in, because one place issues sessions.

**The confirmation link is a GET to a page; the mutation is a POST.** Gmail and
most security appliances pre-fetch the URLs in a message, so a GET that consumed
the token would be spent by the scanner before the recipient clicked. The panel's
POST is guarded by a **ref**, not by effect dependencies — StrictMode runs
effects twice and the second run would consume what the first spent.

**The reset form hashes with `hashPassword()`.** Same as login, registration and
the admin create form. Sending the plaintext stores a hash of the wrong input and
the new password silently does not work.

`admin/` still has no recovery UI, and `admin/scripts/verify-auth-ui.js` still
guards its absence. That is a separate product decision, not an oversight.

## 8. Signup mirrors the admin create-user form, minus the admin fields

`user/src/components/auth/auth-signup-form.tsx` copies the field set and the
validation rules of `admin/src/components/user/account-form.tsx` on purpose. If
you change one, change the other, and check `UserCreatePayload`.

What the client must never send, and the server must never read from a request:

| Field | Assigned by |
|---|---|
| `isAdmin` | `registerNewUser` → always `false` |
| `status` | `registerNewUser` → always `USER_STATUS.ACTIVE` |
| `verifiedEmail` | `registerNewUser` → always `false` |

`RegisterPayload` is `PickType(UserCreatePayload, ['firstName', 'lastName',
'name', 'username', 'gender'])` plus a required `email` and `password` — seven
fields, exactly what the form renders, and nothing else.

**Pick, never omit.** An omit list is a denial list: correct only until somebody
adds a field to `UserCreatePayload`, at which point the new field silently joins
the public API of an unauthenticated endpoint. `dateOfBirth` is the live example
— declared on the base class, not on the form, and unreachable here because it
was never picked.

**`email` is declared fresh rather than picked**, because class-validator merges
metadata along the prototype chain: inheriting the parent's `@IsOptional()` keeps
winning over an added `@IsNotEmpty()`, and a registration goes through with no
address at all.

Three layers, each load-bearing on its own: the allow-list decides what the shape
has; `whitelist: true` on the controller's pipe strips the rest; `registerNewUser`
assigns role/status/verified-email itself. Note the repo convention is
`whitelist` **without** `forbidNonWhitelisted` — the global pipe in `main.ts` sets
neither — so extra fields are *stripped*, not rejected. Tests assert stripping,
not a 400.

`POST /admin/users` keeps `@Roles('admin')` + `RoleGuard` and its admin-only
fields. Registration exists so that route never has to be opened up —
`register.controller.spec.ts` asserts the guard metadata is still there.

## 8b. Passwords: one hasher, scrypt, lazy migration

`PasswordHasherService` is the only thing that hashes, compares or classifies a
credential. Registration, admin create-user and both password-change paths go
through `createAuthPassword`; nothing implements hashing of its own.

Format is self-describing, with the cost parameters *inside* each hash so raising
them later cannot lock anybody out:

```text
scrypt$v=1$N=32768,r=8,p=1$<salt-base64>$<derived-key-base64>
```

Rules that are easy to get wrong:

- **Detect by prefix, never by shape.** "Not scrypt" does not mean "legacy" — a
  corrupted value satisfies that and would be handed to the legacy verifier on a
  guess. A legacy credential is a hex digest *and* a separate `salt` column.
- **Never throw for a bad credential.** Malformed, unknown version, unparseable
  parameters — all are an authentication failure. A 500 tells an attacker their
  input reached something that parses.
- **Upgrade only on a correct password**, and only with a compare-and-set on
  `{_id, value, salt}`. Re-hashing on a failed attempt lets anyone rewrite a
  credential by guessing; a blind update lets a slow login overwrite a password
  change that happened while it was running.
- **A failed upgrade must not fail the login.** The password was correct and the
  session is earned; log it and retry on the next login.

### Create and replace are different operations

Conflating them produces **false successes**, which is worse than an error:

| | MongoDB update | Absent | Already there |
|---|---|---|---|
| `createAuthPassword` | `$setOnInsert` only, `upsert: true, new: false` | inserts | different password → 409; same password → idempotent |
| `replaceAuthPassword` | `$set` + `$unset: { salt }`, **no upsert** | 404 | replaces |
| `setAuthPassword` | replace, then create on 404 | — | entry point for a change |

`new: false` is load-bearing: the return value *is* the answer to "did this
already exist" — `null` means this call did the insert.

`create` used `$set` on an upsert until 2026-08-26. Two concurrent creates with
different passwords both reported success while one password silently lost, so a
caller was told their password was saved for an account that would reject it.
Never write a credential with an update that cannot tell insert from update.

A single row is guaranteed by `idx_userId_type_unique_credential`; a collision on
*that* index is handled, anything else is `CredentialWriteConflictException`,
never a driver 500. Concurrent *replaces* are last-write-wins and observable —
that is fine, because a password change has no expected previous value to compare
against. The lazy legacy upgrade does have one, and still uses compare-and-set.

`AuthDto` must never expose `value` or `salt`.

Verify with `node api/scripts/verify-password-migration.js` and
`node api/scripts/verify-auth-credential-uniqueness.js` — both use disposable
databases with real indexes. Repair existing data with
`repair-auth-credential-duplicates.js` (dry-run by default).

## 8c. `data` is the request; `intent` is the server

`createNewUserAccount(data, intent)`. `data` is request-shaped and its `status`,
`isAdmin` and `isCreator` are **ignored**. `intent` is stated by code that has
already established what the caller may do: the admin controller forwards the
administrator's validated status, `registerNewUser` hard-codes an ordinary active
account.

Assign from `intent`, never merge with `data` — a merge is exactly how a public
endpoint inherits an admin capability the day somebody adds the field to a shared
payload.

## 9. Registration issues no session

`POST /auth/register` returns the created profile and nothing else. The client
then calls the ordinary credentials sign-in. One place issues sessions.

## 10. Concurrency is settled by the unique index, not the pre-check

`isEmailOrUsernameTaken` is a read; two registrations can pass it together.
`createUserDocument` catches the collision and checks
`error.keyPattern.email` / `.username` — never `code === 11000` alone, which says
nothing about *which* index collided and would report an unrelated write
conflict as a taken email.

**A live HTTP probe cannot prove this.** The throttler (5 requests / 5 minutes)
rejects the second request before it reaches the database, so "only one account
was created" comes from the rate limiter rather than from the index. Verify with
`node api/scripts/verify-registration-concurrency.js` instead: it creates a
disposable database, runs `syncIndexes()`, reads the indexes back, and races
`registerNewUser` directly. It asserts one user row, one auth row, no orphans,
for same-email, same-username and identical payloads. Re-run it after any change
to the create path or to the user schema's indexes.

Reported by that script and worth knowing: the `auth` collection has **no**
unique index. Registration is unaffected — each winner is a distinct user — but
nothing at the database level stops two password rows for one user.

## 11. Payload classes are types in `user.service.ts` — keep them that way

`registerNewUser` builds a plain object literal, not `new UserCreatePayload(...)`.
Constructing one turns `import { ... } from 'src/payloads'` into a **runtime**
import of the whole payload barrel, which drags `isomorphic-dompurify` (ESM)
into every Jest suite that transitively reaches this service. It broke 29 suites
in one line. Specs that must load the barrel stub it:

```ts
jest.mock('isomorphic-dompurify', () => ({ sanitize: (value: string) => value }));
```

## 12. QR login is a fixed asset and must stay inert

`user/public/login-qr-placeholder.svg` plus a "Coming soon" note. No API call, no
polling, no simulated signed-in state. A placeholder that looked live would have
somebody standing there scanning it.

## 13. Dialog chrome comes from `ModalComponent`

Overlay, scroll lock, Escape, focus trap, backdrop click, `role="dialog"` and
`aria-modal` all live in `user/src/components/ui/modal.tsx`. `ariaLabel` and
`initialFocusRef` were added there for this dialog — use them rather than
reimplementing focus handling. Note that `@components/ui/form-field` is painted
dark for the creator publish flow; the auth dialog follows the page theme, which
is why `auth-fields.tsx` exists.

## Files

| Concern | File |
|---|---|
| Open/close/mode state, URL trigger | `user/src/providers/auth-modal.provider.tsx` |
| Dialog shell | `user/src/components/auth/auth-modal.tsx` |
| Forms | `user/src/components/auth/auth-login-form.tsx`, `auth-signup-form.tsx` |
| Themed inputs | `user/src/components/auth/auth-fields.tsx` |
| QR placeholder | `user/src/components/auth/auth-qr-panel.tsx` |
| Route guard | `user/src/components/auth/auth-required-gate.tsx` |
| Retired URLs | `user/src/proxy.ts` |
| Public endpoint | `api/src/controllers/identity/auth/register.controller.ts` |
| Confirmation + resend | `api/src/controllers/identity/auth/verification.controller.ts` |
| Forgot + reset | `api/src/controllers/identity/auth/password-recovery.controller.ts` |
| Token lifecycle | `api/src/services/identity/auth/auth-token.service.ts` |
| Dialog recovery pane | `user/src/components/auth/auth-forgot-form.tsx` |
| Shared resend control | `user/src/components/auth/auth-resend-verification.tsx`, `auth-verification-notice.tsx` |
| Public token pages | `user/src/app/auth/verify-email/`, `user/src/app/auth/reset-password/` |
| Payload | `api/src/payloads/identity/auth/register.payload.ts` |
| Service | `api/src/services/identity/user/user.service.ts` (`registerNewUser`, `createUserDocument`) |
| Tests | `user/src/providers/auth-modal.provider.spec.tsx`, `user/src/proxy.spec.ts`, `api/src/services/identity/user/user-registration.spec.ts`, `api/src/controllers/identity/auth/register.controller.spec.ts` |
| Password hashing | `api/src/services/identity/auth/password-hasher.service.ts` |
| Protected data page | `user/src/app/(public)/(main)/following/page.tsx` |
| Signing out | `user/src/hooks/use-logout.ts`, `user/src/lib/session-expired.ts` |
| Friends (mutual follow) | `api/src/services/community/follow/follow.service.ts`, `user/src/app/(public)/(main)/friend/page.tsx` |
| Live probes (disposable DB, real indexes) | `api/scripts/verify-registration-concurrency.js`, `verify-password-migration.js`, `verify-password-change.js`, `verify-auth-credential-uniqueness.js` |
| Maintenance | `api/scripts/repair-auth-credential-duplicates.js` |
| Admin auth UI guard | `admin/scripts/verify-auth-ui.js` |
