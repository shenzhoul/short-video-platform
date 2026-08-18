---
title: API Endpoint to UI Mapping
description: Current HTTP endpoints mapped to their primary web services, hooks, pages, and components.
audience: [developer-agent]
domain: cross
status: active
updated: 2026-07-31
tags: [api, ui, mapping]
---

# API Endpoint to UI Mapping

| API area | Main endpoints | User/admin consumers |
|---|---|---|
| Authentication | `POST /auth/login`, `/auth/logout*` | user/admin `auth-options.ts`, login/logout components |
| Current/public user | `GET /users/me`, `GET /users/:username`, `PUT /users/manager` | `user.service.ts`, profile provider, creator profile/edit components |
| Profile media | `POST /identity/files/user/avatar/upload`, `/creator/cover/upload`; `PUT /users/me/avatar`, `/users/cover` | avatar/cover upload components and `file-upload.service.ts` |
| Public posts | `GET /posts/home-posts`, `/recommended`, `/:id` | `post.service.ts`, feed hooks, home/For You/post-detail components |
| Creator posts | `POST/GET /creator/posts`, `GET/PUT/DELETE /creator/posts/:id` | post list/create/update pages and post form/table components |
| Post media | `/content/files/post/*` upload and video-draft routes | upload modal, post form, draft/handoff services |
| Comments | `GET/POST /social/:type/:id/comments`, `PUT/DELETE /social/comments/:id` | `comment.service.ts`, `use-comments.ts`, comment components |
| Reactions | `POST /social/:type/:id/reactions/toggle` | `reaction.service.ts`, like button |
| Public settings | `GET /settings/public`, `POST /settings/keys` | user/admin layouts and setting services |
| Admin settings | `GET /admin/settings`, `PUT /admin/settings/:key`, settings image upload | admin settings hooks/forms |
| Admin users | `/admin/users*`, `/admin/permissions*`, password/avatar routes | admin user service, hooks, forms, list, role management |
| Logs | logger service endpoints registered by the API app controller set | admin logger service/hooks/list components |

Exact request/response behavior remains defined by controller decorators, payloads, DTOs, and the consuming service code.
