---
title: Enforce File Size Limits
impact: HIGH
impactDescription: Prevents abuse, storage exhaustion, and performance issues
tags: security, validation, size-limits, abuse-prevention
---

## Enforce File Size Limits

Enforce file size limits on both client and server. **Never hardcode MB limits** — use centralized upload settings.

**Why**: Unlimited file sizes can exhaust storage, bandwidth, and cause performance issues. Centralized settings keep admin UI, API, and file-server aligned.

**Single source of truth (2026-07-01)**:
- Settings keys: `upload.limit.*` (see `docs/domains/content/upload-settings.md`)
- API validation: `UploadLimitService` via `FileServerService.generateUploadUrl()`
- User app: `useUploadLimit('avatar')`, `useUploadLimits()`
- Admin app: `useUploadLimits()` from `config.context`
- Constants/mapping: `api/src/common/constants/upload-limits.ts`

**Incorrect (hardcoded limits):**

```typescript
const MAX_AVATAR_SIZE = 10 * 1024 * 1024; // ❌ do not hardcode

@Post('upload-url')
async badUploadUrl(@Body() body: { filename: string; fileSize: number }) {
  return this.fileServerService.generateUploadUrl({
    filename: body.filename,
    fileSize: body.fileSize
  }); // ❌ no validation
}
```

**Correct (centralized settings):**

```typescript
// API — validation is automatic in FileServerService.generateUploadUrl()
const uploadData = await this.fileServerService.generateUploadUrl({
  filename: body.filename,
  fileSize: body.fileSize,
  mediaType: 'image',
  type: 'avatar'
});

// User app — show limit before upload
const avatarLimitMb = useUploadLimit('avatar');
// helpText: `Maximum avatar size: ${avatarLimitMb} MB`
```

**Server ceiling**: Effective limit = min(admin setting, `FILE_MAX_SIZE_*` / nginx `client_max_body_size`). If admin exceeds server cap, API logs a warning and caps the effective limit.

**Large files**: Use TUS with chunking; TUS max is also capped by upload settings.

See also: `.agents/skills/system-settings/SKILL.md`, `docs/domains/content/upload-settings.md`
