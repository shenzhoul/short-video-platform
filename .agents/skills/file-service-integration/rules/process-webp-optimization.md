---
title: Use WebP Optimization
impact: MEDIUM
impactDescription: Reduces bandwidth by 25-35% while maintaining quality
tags: processing, webp, optimization, performance
---

## Use WebP Optimization

Set `imageFormat: 'webp'` for web-delivered images to optimize bandwidth and loading times.

**Why**: WebP provides superior compression (25-35% smaller) compared to JPEG/PNG while maintaining visual quality.

**Format Guidelines**:
- **Web images**: Use `webp` (best compression)
- **Print/professional**: Use `png` (lossless)
- **Photography**: Use `jpeg` (good for photos, widely supported)
- **Transparency**: Use `png` or `webp` (supports alpha channel)

**Incorrect (no format optimization):**

```typescript
async badUpload() {
  return this.fileServerService.generateImageUploadUrl({
    mediaType: 'image',
    processingOptions: {
      // Missing imageFormat - will keep original (possibly large) format
      quality: 85
    }
  });
}
```

**Correct (WebP optimization):**

```typescript
async uploadWebImage() {
  return this.fileServerService.generateImageUploadUrl({
    mediaType: 'image',
    type: 'content',
    processingOptions: {
      imageFormat: 'webp', // ✅ Convert to WebP
      quality: 85, // Good balance of size/quality
      resizeWidth: 1200,
      generateThumbnail: true,
      thumbnailWidth: 300
    }
  });
}

// For print/professional use - keep original format
async uploadPrintImage() {
  return this.fileServerService.generateImageUploadUrl({
    mediaType: 'image',
    type: 'print-quality',
    processingOptions: {
      imageFormat: 'png', // Keep high quality
      quality: 100,
      // No resizing for print quality
    }
  });
}
```
