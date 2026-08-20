---
title: Feature Index
description: Index of user-visible and operational features implemented in the current repository.
audience: [user, creator, admin, developer-agent]
domain: cross
status: active
updated: 2026-08-13
tags: [features, index]
---

# Feature Index

These documents describe shipped workflows. Domain documents remain the source of truth for ownership and data boundaries.

| Feature | Document | Main surfaces |
|---|---|---|
| Credentials authentication | [authentication.md](./authentication.md) | User/admin login and logout |
| Creator profiles | [creator-profiles.md](./creator-profiles.md) | Public profile, self-edit, avatar/cover |
| Post publishing | [post-publishing.md](./post-publishing.md) | Text/photo/video create, edit, delete |
| Feeds and recommendations | [feeds-and-recommendations.md](./feeds-and-recommendations.md) | Home, For You, profile posts, post detail |
| Search and discovery | [search-and-discovery.md](./search-and-discovery.md) | Header discovery, autocomplete, search results |
| Creator following | [following.md](./following.md) | Avatar follow action, Following rail and feed |
| Comments and reactions | [comments-and-reactions.md](./comments-and-reactions.md) | Comments, replies, edit/delete, likes |
| Interaction notifications | [notifications.md](./notifications.md) | Grouped like/comment/reply/follow notifications, realtime delivery, category filter, header panel |
| Direct messaging | [messaging.md](./messaging.md) | Private one-to-one messages, follow-based send permission, right-side workspace and page reflow, `/messages` |
| Post sharing | [sharing.md](./sharing.md) | Share panel, recorded shares, `totalShare` |
| File uploads and processing | [file-uploads-and-processing.md](./file-uploads-and-processing.md) | Direct/TUS uploads, ownership, Sharp/FFmpeg |
| Admin operations | [admin-operations.md](./admin-operations.md) | Users, admins, settings, logs |
| Online status | [online-status.md](./online-status.md) | Socket authentication and presence events |

Features without matching controllers, schemas, services, pages, or dependencies are intentionally excluded.
