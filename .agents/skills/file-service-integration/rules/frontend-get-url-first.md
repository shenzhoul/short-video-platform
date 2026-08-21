---
title: Get Upload URL First
impact: HIGH
impactDescription: Enables authentication, tracking, and CDN delivery
tags: frontend, upload, workflow, security
---

## Get Upload URL First

Always request upload URL from backend before uploading the file.

**Why**: Upload URLs contain secure tokens, file IDs, and configuration. This enables proper authentication, tracking, and CDN delivery.

**Incorrect (direct upload without URL):**

```typescript
async badUpload(file: File) {
  // Don't upload directly without getting URL first!
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/files/upload', {
    method: 'POST',
    body: formData
  });
  // Missing: authentication, file ID, CDN configuration
}
```

**Correct (two-step upload process):**

```typescript
async uploadAvatar(file: File) {
  try {
    // Step 1: Get upload URL with configuration
    const uploadUrlResponse = await fileUploadService.getUploadUrl(
      '/user/avatar/upload',
      {
        filename: file.name,
        fileSize: file.size,
        type: 'avatar'
      }
    );

    // Step 2: Upload file using the URL
    const result = await fileUploadService.uploadFile(
      uploadUrlResponse.uploadUrl,
      file,
      {},
      (progress) => {
        console.log(`Upload progress: ${progress.percentage}%`);
      }
    );

    return result;
  } catch (error) {
    console.error('Upload failed:', error);
    throw error;
  }
}
```
