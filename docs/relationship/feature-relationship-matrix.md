---
title: Feature Relationship Matrix
description: Implemented features mapped to applications, domains, persistence, queues, and sockets.
audience: [developer-agent]
domain: cross
status: active
updated: 2026-07-31
tags: [features, matrix, impact]
---

# Feature Relationship Matrix

| Feature | User app | Admin app | API domain | File server | MongoDB | Redis/BullMQ | Socket.IO |
|---|:---:|:---:|---|:---:|:---:|:---:|:---:|
| Credentials authentication | ✓ | ✓ | Identity |  | ✓ | cache/throttle |  |
| Creator profiles | ✓ | ✓ | Identity | ✓ | ✓ | file events/cache |  |
| Post publishing | ✓ |  | Content | ✓ | ✓ | file/delete/stat events |  |
| Home/profile feeds | ✓ |  | Content |  | ✓ | optional user/cache context |  |
| Recommendations | ✓ |  | Content |  | ✓ |  |  |
| Comments/replies | ✓ |  | Community |  | ✓ | counter/delete events |  |
| Like reactions | ✓ |  | Community |  | ✓ | counter events |  |
| Site settings | ✓ | ✓ | System | ✓ for images | ✓ | cache/pub-sub |  |
| Admin user management |  | ✓ | Identity | ✓ for avatars | ✓ | cleanup events |  |
| Operational logs |  | ✓ | Shared/system |  | ✓ |  |  |
| Online status | ✓ |  | Socket/identity |  |  | scheduler/events | ✓ |
| Media processing | ✓ upload client | ✓ upload client | Shared file client | ✓ | ✓ | processing queue |  |

Use this table as a blast-radius checklist before changing a feature contract.
