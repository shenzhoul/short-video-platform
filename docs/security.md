---
title: Security
description: Security controls implemented in the current codebase and limitations operators must account for.
audience: [admin, operator, developer-agent]
domain: cross
status: active
updated: 2026-07-31
tags: [security, auth, validation, rate-limit, upload]
---

# Security

## Implemented controls

- NextAuth credentials sessions in both web apps.
- API authentication/load-user/role guards and admin route separation.
- Class-validator payload validation, whitelist transforms, Mongo ID validation on many inputs, and HTML sanitization for post text.
- Redis-backed throttling and per-endpoint limits on sensitive/high-volume actions.
- CORS and production proxy configuration hooks.
- File-server API/internal keys, JWT upload authorization, file ownership/reference checks, type/size validation, and non-public internal endpoints.
- MongoDB indexes for identity, feeds, comments/reactions, settings, and logs.
- Production HTTP exception responses suppress development error detail.

## Operator requirements

- Set strong, matching API/file-server secrets; never rely on fallback development strings.
- Set `NEXTAUTH_SECRET`, MongoDB credentials, Redis credentials, explicit CORS origins, trusted proxy values, and public/internal base URLs.
- Restrict file-server internal routes at the network layer.
- Keep FFmpeg, Sharp, Node.js, NestJS, Next.js, MongoDB, and Redis patched.
- Back up MongoDB and stored files together so references remain consistent.

## Current limitations

The repository does not contain checked-in TLS termination, nginx security headers, WAF rules, malware scanning, S3 policies, automated backup/restore, 2FA, OAuth provider configuration, or formal compliance controls. Those must not be claimed as platform capabilities.

Some source files contain development fallback secrets; production deployment must override them. A dedicated secret-management and deployment baseline should be added before public production use.
