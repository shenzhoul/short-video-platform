---
title: Immediate Processing for Small Images
impact: HIGH
impactDescription: Provides instant feedback for critical UI elements
tags: processing, images, performance, ux
---

## Immediate Processing for Small Images

Set `immediateProcess: true` for small images (< 5MB) that need instant feedback.

**Why**: Immediate processing provides better UX for critical images like avatars or profile photos by processing synchronously.

**Guidelines**:
- Immediate processing: Avatars, small logos, icons (< 5MB)
- Queue processing: Banners, hero images, large photos (> 5MB)
- Always use webhooks with queued processing

**Incorrect (immediate for large image):**

```typescript
async badUpload() {
  return this.fileServerService.generateImageUploadUrl({
    type: 'large-banner',
    processingOptions: {
      immediateProcess: true, // Will timeout for large files!
      resizeWidth: 3840, // 4K image
      resizeHeight: 2160
    }
  });
}
```

**Correct (appropriate processing mode):**

```typescript
// Immediate processing for avatars
async uploadAvatar() {
  return this.fileServerService.generateImageUploadUrl({
    mediaType: 'image',
    type: 'avatar',
    processingOptions: {
      immediateProcess: true, // ✅ Process during upload
      generateThumbnail: true,
      thumbnailWidth: 200,
      thumbnailHeight: 200,
      imageFormat: 'webp',
      quality: 85
    }
  });
  // User can see processed avatar immediately after upload
}

// Large banner - queue processing
async uploadBanner() {
  return this.fileServerService.generateImageUploadUrl({
    mediaType: 'image',
    type: 'banner',
    processingOptions: {
      immediateProcess: false, // ✅ Queue for background
      generateThumbnail: true,
      resizeWidth: 1920,
      imageFormat: 'webp',
      webhookUrl: `${process.env.WEBHOOK_BASE_URL}/webhooks/banner-processed`
    }
  });
  // Webhook notifies when processing completes
}
```
