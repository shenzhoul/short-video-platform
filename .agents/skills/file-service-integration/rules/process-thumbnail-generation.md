---
title: Enable Thumbnail Generation
impact: MEDIUM
impactDescription: Improves performance and bandwidth usage
tags: processing, thumbnails, performance, optimization
---

## Enable Thumbnail Generation

Enable `generateThumbnail: true` for all images and videos that will be displayed in galleries or lists.

**Why**: Thumbnails improve performance by reducing bandwidth and loading times. Essential for good UX in galleries and content lists.

**Thumbnail Guidelines**:
- Gallery images: 300x300px thumbnails
- Avatar images: 200x200px thumbnails
- Video thumbnails: Extract from first frame or specific timestamp
- Use square thumbnails for consistent grid layouts

**Incorrect (no thumbnail for gallery):**

```typescript
async badGalleryUpload() {
  return this.fileServerService.generateImageUploadUrl({
    mediaType: 'image',
    type: 'gallery',
    processingOptions: {
      // Missing generateThumbnail - will load full images in gallery!
      imageFormat: 'webp'
    }
  });
}
```

**Correct (thumbnail generation):**

```typescript
async uploadGalleryImage() {
  return this.fileServerService.generateImageUploadUrl({
    mediaType: 'image',
    type: 'gallery',
    processingOptions: {
      generateThumbnail: true, // ✅ Generate thumbnail
      thumbnailWidth: 300,
      thumbnailHeight: 300,
      imageFormat: 'webp',
      quality: 85
    }
  });
}

async uploadVideo() {
  return this.fileServerService.generateVideoUploadUrl({
    mediaType: 'video',
    type: 'content',
    processingOptions: {
      generateThumbnail: true, // ✅ Extract video thumbnail
      generatePreview: true, // ✅ Multiple preview frames
      videoFormat: 'mp4'
    }
  });
}
```
