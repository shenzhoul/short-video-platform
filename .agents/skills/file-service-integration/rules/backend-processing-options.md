---
title: Configure Processing Options
impact: HIGH
impactDescription: Proper configuration improves UX and prevents timeouts
tags: backend, processing, configuration, performance
---

## Configure Processing Options

Configure processing options based on file type and use case.

**Why**: Different files require different processing. Immediate processing for critical images improves UX, while background processing prevents timeouts for large files.

**Processing Options Summary**:
- `immediateProcess: true` - Only for small images (< 5MB)
- `immediateProcess: false` - For videos, large images, background processing
- `processManual: true` - For custom workflows, conditional processing
- `webhookUrl` - Required for async processing status updates
- `generateThumbnail` - Enable for media files (images + videos)
- `imageFormat: 'webp'` - Optimize for web delivery

**Incorrect (immediate processing for large video):**

```typescript
async wrongProcessing() {
  // Immediate processing for large video - will timeout!
  return this.fileServerService.generateVideoUploadUrl({
    mediaType: 'video',
    processingOptions: {
      immediateProcess: true // WRONG! Videos always queued
    }
  });
}
```

**Correct (appropriate processing options):**

```typescript
class ProcessingExamplesController {
  // Small avatar - immediate processing for instant feedback
  async uploadAvatar() {
    return this.fileServerService.generateImageUploadUrl({
      mediaType: 'image',
      type: 'avatar',
      processingOptions: {
        immediateProcess: true, // Process immediately
        generateThumbnail: true,
        thumbnailWidth: 200,
        thumbnailHeight: 200,
        imageFormat: 'webp',
        quality: 85
      }
    });
  }

  // Large banner image - queue processing to avoid timeout
  async uploadBanner() {
    return this.fileServerService.generateImageUploadUrl({
      mediaType: 'image',
      type: 'banner',
      processingOptions: {
        immediateProcess: false, // Queue for background processing
        generateThumbnail: true,
        resizeWidth: 1920,
        resizeHeight: 1080,
        imageFormat: 'webp',
        quality: 90,
        webhookUrl: `${process.env.WEBHOOK_BASE_URL}/webhooks/banner-processed`
      }
    });
  }

  // Video - always background processing
  async uploadVideo() {
    return this.fileServerService.generateVideoUploadUrl({
      mediaType: 'video',
      type: 'content',
      processingOptions: {
        immediateProcess: false, // Videos NEVER immediate
        generateThumbnail: true,
        generatePreview: true,
        videoFormat: 'mp4',
        quality: 80,
        webhookUrl: `${process.env.WEBHOOK_BASE_URL}/webhooks/video-processed`
      }
    });
  }

  // Manual processing - upload only, trigger later
  async uploadForReview() {
    return this.fileServerService.generateImageUploadUrl({
      mediaType: 'image',
      type: 'review',
      processingOptions: {
        processManual: true // Skip automatic processing
      }
    });
    // Later: await this.fileServerService.triggerProcessing(fileId, options);
  }
}
```
