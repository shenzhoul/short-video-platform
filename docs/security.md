---
title: Security
description: Security controls implemented in the current codebase and limitations operators must account for.
audience: [admin, operator, developer-agent]
domain: cross
status: active
updated: 2026-08-22
tags: [security, auth, validation, rate-limit, upload]
---

# Security

## Implemented controls

- NextAuth credentials sessions in both web apps.
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
