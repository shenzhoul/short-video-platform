---
name: system-settings
description: System setting lifecycle for Douyin Clone across API migration data, SettingService, public setting reads, file-backed settings, and the admin settings UI.
---

# System Settings

## Current Flow

- Seed definitions in `api/migrations/data/site-settings.js`.
- Apply them through `api/migrations/1735228800000-settings.js` or a new timestamped migration.
- Read and cache settings in `api/src/services/system/setting/setting.service.ts`.
- Expose public settings through `api/src/controllers/system/setting/setting.controller.ts`.
- Manage settings through `api/src/controllers/system/setting/admin-setting.controller.ts`.
- Render admin groups through `admin/src/components/settings/`.
- Read required public values through `user/src/services/setting.service.ts`.

## Rules

- Define the key, group, type, default, visibility, public exposure, and autoload behavior intentionally.
- Do not expose secrets through public setting endpoints.
- Add a migration for new persisted settings; do not rely only on an application constant.
- Invalidate or refresh the settings cache after writes.
- Use the existing setting file-upload controller and file-server flow for file-backed values.
- Add a new group to `admin/src/components/settings/components/settings-menu.tsx`.
- Document the exact admin navigation and field labels.

## Verification

- Check default seeding, admin read/write, validation, cache refresh, public visibility, secret exclusion, and file upload when applicable.
- Run `yarn build` in `api/` and user/admin verification when their consumers change.
