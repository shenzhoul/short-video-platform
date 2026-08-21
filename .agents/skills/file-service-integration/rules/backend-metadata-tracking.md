---
title: Include Metadata Tracking
impact: MEDIUM
impactDescription: Enables auditing, debugging, and file ownership management
tags: backend, metadata, auditing, tracking
---

## Include Metadata Tracking

Include `uploadedBy`, `createdBy`, and relevant metadata in all file upload requests.

**Why**: Tracking who uploaded files enables auditing, debugging, and proper file ownership management.

**Incorrect (no metadata):**

```typescript
async badUpload(body: { filename: string }) {
  return this.fileServerService.generateUploadUrl({
    filename: body.filename
    // Missing metadata and createdBy - can't track who uploaded!
  });
}
```

**Correct (comprehensive metadata):**

```typescript
@Post('upload')
async uploadFile(
  @Body() body: { filename: string },
  @CurrentUser() user: AuthUserDto
) {
  return this.fileServerService.generateUploadUrl({
    filename: body.filename,
    type: 'user-content',
    metadata: {
      uploadedBy: user._id, // ✅ Track uploader
      uploadedByUsername: user.username,
      uploadedAt: new Date().toISOString(),
      userType: user.role,
      ipAddress: body.ipAddress, // If available
      userAgent: body.userAgent // If available
    },
    createdBy: user._id // ✅ Required field
  });
}
```
