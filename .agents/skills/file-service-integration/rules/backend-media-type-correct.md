---
title: Use Correct Media Type
impact: CRITICAL
impactDescription: Media type determines processing behavior and capabilities
tags: backend, media-types, processing, configuration
---

## Use Correct Media Type

Use the correct mediaType for each file category: `image`, `video`, `document`, or `file`.

**Why**: Media type determines processing behavior. Images can be processed immediately, videos are always queued, documents have metadata extraction, and files are upload-only.

**Media Type Summary**:
- `image` or `photo`: Images that need processing (thumbnails, optimization)
- `video`: Videos that need encoding/compression (always async)
- `document`: Documents for metadata extraction
- `file`: Generic files, upload-only, no processing

**Incorrect (wrong media type for image):**

```typescript
async wrongMediaType() {
  // Using 'file' for an image that needs processing
  return this.fileServerService.generateUploadUrl({
    mediaType: 'file', // Wrong! Use 'image' for processing
    type: 'avatar',
    processingOptions: { generateThumbnail: true } // Won't work with 'file'
  });
}
```

**Correct (proper media types):**

```typescript
class FileUploadController {
  // For user avatars and photos
  async uploadProfilePhoto() {
    return this.fileServerService.generateImageUploadUrl({
      mediaType: 'image', // or 'photo' (alias)
      type: 'avatar',
      processingOptions: { immediateProcess: true }
    });
  }

  // For video content
  async uploadVideo() {
    return this.fileServerService.generateVideoUploadUrl({
      mediaType: 'video',
      type: 'content',
      processingOptions: {
        immediateProcess: false, // Videos always queued
        generateThumbnail: true
      }
    });
  }

  // For PDFs and documents
  async uploadDocument() {
    return this.fileServerService.generateDocumentUploadUrl({
      mediaType: 'document',
      type: 'attachment',
      acl: 'private'
    });
  }

  // For raw files (no processing)
  async uploadRawFile() {
    return this.fileServerService.generateUploadUrl({
      mediaType: 'file', // Upload-only, no processing
      type: 'backup',
      acl: 'private'
    });
  }
}
```
