---
title: Generate Secure Upload URLs
impact: CRITICAL
impactDescription: Provides secure, token-based uploads without exposing credentials
tags: backend, security, upload, authentication
---

## Generate Secure Upload URLs

Generate secure upload URLs using generateUploadUrl() with proper configuration options.

**Why**: Pre-signed URLs provide secure, token-based uploads without exposing API keys or credentials. Different file types require different configurations.

**Incorrect (missing critical options):**

```typescript
async badUploadUrl(body: { filename: string }) {
  const uploadData = await this.fileServerService.generateUploadUrl({
    filename: body.filename
    // Missing: mediaType, acl, processingOptions, metadata
  });
  return DataResponse.ok(uploadData);
}
```

**Correct (comprehensive configuration):**

```typescript
async generateAvatarUploadUrl(user: AuthUserDto, body: { filename: string }) {
  const uploadData = await this.fileServerService.generateImageUploadUrl({
    filename: body.filename,
    type: 'avatar',
    acl: 'public-read',
    processingOptions: {
      generateThumbnail: true,
      thumbnailWidth: 200,
      thumbnailHeight: 200,
      imageFormat: 'webp',
      quality: 85,
      immediateProcess: true
    },
    metadata: {
      uploadedBy: user._id,
      uploadedAt: new Date().toISOString()
    },
    createdBy: user._id
  });

  return DataResponse.ok(uploadData);
}
```
