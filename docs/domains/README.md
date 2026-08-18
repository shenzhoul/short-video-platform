---
title: Domain Index
description: Canonical domain ownership for the current repository.
audience: [developer-agent]
domain: cross
status: active
updated: 2026-08-05
tags: [domains, index]
---

# Domain Index

| Domain | Canonical document | Main code |
|---|---|---|
| Identity | [identity.md](./identity.md) | `api/src/{controllers,services,schemas,payloads,dtos}/identity`, user/admin auth and profile UI |
| Content | [content.md](./content.md) | `api/src/.../content`, `user/src/components/content` |
| Community | [community.md](./community.md) | `api/src/.../community`, `user/src/components/comment`, interaction components |
| System | [system.md](./system.md) | API settings/logging and admin settings/log viewers |
| File service | [file-service.md](./file-service.md) | API file integration, user/admin upload clients, `file-server/` |

Finance, payment, paid subscription, wallet, payout, product/store, publishing/banner, messaging, notification, mutual-friend, report/block, and streaming are not current domains. One-way creator following belongs to Community.
