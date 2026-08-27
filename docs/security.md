---
title: Security
description: Security controls implemented in the current codebase and limitations operators must account for.
audience: [admin, operator, developer-agent]
domain: cross
status: active
updated: 2026-08-26
tags: [security, auth, password, validation, rate-limit, upload]
---

# Security

## Implemented controls

- NextAuth credentials sessions in both web apps.
- Passwords hashed with scrypt (`node:crypto`, RFC 7914) at `N=2^15, r=8, p=1`, one random
  salt per credential, compared with `timingSafeEqual`. Cost parameters are stored inside each
  hash so they can be raised without invalidating existing credentials.
- A unique index on `auth.{ userId, type }` plus an atomic upsert, so one user cannot end up
  with two credentials of the same kind.
- API authentication/load-user/role guards and admin route separation.
- Class-validator payload validation, whitelist transforms, Mongo ID validation on many inputs, and HTML sanitization for post text.
- Redis-backed throttling and per-endpoint limits on sensitive/high-volume actions.
- CORS and production proxy configuration hooks.
- File-server internal routes (`/internal/files/*`) require two service credentials — `API_SECRET_KEY`
  as `X-API-Key` and `INTERNAL_API_KEY` as `X-Internal-API-Key` — compared in constant time by
  `InternalApiGuard`. Bearer JWTs are rejected there on purpose (see "Credential separation" below).
- JWT upload authorization, file ownership/reference checks, and type/size validation on uploads.
- MongoDB indexes for identity, feeds, comments/reactions, settings, and logs.
- Production HTTP exception responses suppress development error detail.

## Operator requirements

- Set strong, matching API/file-server secrets; never rely on fallback development strings.
  `JWT_SECRET` has no fallback at all — the file server refuses to sign file URLs without it.
- Set `NEXTAUTH_SECRET`, MongoDB credentials, Redis credentials, explicit CORS origins, trusted proxy values, and public/internal base URLs.
- Restrict file-server internal routes at the network layer.
- Keep FFmpeg, Sharp, Node.js, NestJS, Next.js, MongoDB, and Redis patched.
- Back up MongoDB and stored files together so references remain consistent.

## Password hashing (2026-08-26)

Passwords were previously stored as a **single salted SHA256 round**. SHA256 is built to be fast,
so a stolen `auth` collection was close to a plaintext list — the salt stopped rainbow tables and
nothing more. (The code's own comments claimed PBKDF2 with 10,000 iterations, which was never true.)

New and changed passwords now use scrypt. Credentials written before the change are migrated
**lazily**: there is no plaintext to bulk-convert, so a legacy credential is verified with the old
algorithm at login and, only on success, re-hashed with scrypt. Nobody is forced to reset a password.

Operator note: until every account has signed in at least once, some credentials remain on the old
scheme. There is no way to accelerate that without a password reset flow, which this product does
not have. `db.auth.countDocuments({ salt: { $exists: true } })` reports how many are left.

## Credential separation (2026-08-22)

`JWT_SECRET` signs every token the file server issues to browsers: direct-upload tokens, TUS tokens,
and signed file URLs. Any check of the form "does this JWT verify against `JWT_SECRET`" therefore
accepts a credential that ordinary users hold.

That was a real defect, not a theoretical one: the previous `AuthGuard` on `/internal/files/*` did
exactly that, so any user who started an upload could call `batch-delete`, `update-ownership` and
`remove-unused-files` over every user's media. Fixed 2026-08-22 by replacing it with
`InternalApiGuard`, which accepts service API keys only.

Rules that follow from this, for anyone touching file-server auth:

- Never authenticate an internal or administrative route with a JWT signed by `JWT_SECRET`.
- Every issued token carries a `purpose` claim (`file-upload`, `tus-upload`, `signed-url`), and the
  consuming path verifies it. A valid signature proves the service issued the token, not what the
  holder may do with it.
- Keep `API_SECRET_KEY`, `INTERNAL_API_KEY` and `JWT_SECRET` as three distinct values.

## Current limitations

The repository does not contain checked-in TLS termination, nginx security headers, WAF rules, malware scanning, S3 policies, automated backup/restore, 2FA, OAuth provider configuration, or formal compliance controls. Those must not be claimed as platform capabilities.

Some source files contain development fallback secrets; production deployment must override them. A dedicated secret-management and deployment baseline should be added before public production use.
