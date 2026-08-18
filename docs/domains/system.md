---
title: System Domain
description: Site settings, maintenance configuration, and operational logs.
audience: [admin, operator, developer-agent]
domain: system
status: active
updated: 2026-07-31
tags: [settings, maintenance, logging, admin]
---

# System Domain

## Settings

The only registered setting group is `site`. Supported keys are:

- `site.identity.name`
- `site.identity.logoUrl`
- `site.identity.whiteLogoUrl`
- `site.identity.faviconUrl`
- `site.identity.pageLoadingIconUrl`
- `site.maintenance.enabled`
- `site.maintenance.imageUrl`

Public/autoload settings are consumed by the user and admin layouts. Admins manage them at `/system/settings`; image settings are uploaded through the API/file-server ownership flow.

API routes:

- `GET /settings/public`
- `POST /settings/keys`
- `GET /admin/settings`
- `PUT /admin/settings/:key`
- `POST /admin/settings/files/image/upload`

## Logging

The API persists audit, request, HTTP-exception, and system logs. The admin app provides separate viewers under `/system/logger/*`.

## Migrations

`api/migrations/1735228800000-settings.js` invokes the settings seed script. `1756258634605-create-admin-account.js` invokes the admin account/reset script.
