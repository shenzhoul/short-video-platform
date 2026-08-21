---
title: Use TUS for Large Files
impact: HIGH
impactDescription: Enables resumable uploads, prevents data loss
tags: frontend, tus, resumable, large-files
---

## Use TUS for Large Files

Use TUS resumable upload for files larger than 10MB.

**Why**: TUS enables resumable uploads, preventing data loss on network failures and improving UX for large files.

**File Size Guidelines**:
- < 10MB: Normal upload (faster, simpler)
- 10MB - 100MB: TUS upload (resumable)
- > 100MB: TUS upload with chunking optimization

**Incorrect (normal upload for large files):**

```typescript
async badUpload(file: File) {
  // Don't use normal upload for large files!
  const uploadData = await this.getUploadUrl('/files/upload', {
    filename: file.name,
    uploadType: 'normal' // Wrong for large files!
  });

  // Large file upload will fail or be slow without resume capability
  return this.uploadFileNormal(uploadData, file);
}
```

**Correct (TUS for large files):**

```typescript
async uploadFile(file: File, onProgress?: (progress: UploadProgress) => void) {
  const FILE_SIZE_THRESHOLD = 10 * 1024 * 1024; // 10MB

  try {
    // Determine upload method based on file size
    const uploadType = file.size > FILE_SIZE_THRESHOLD ? 'tus' : 'normal';

    // Get upload URL with specified method
    const uploadData = await this.getUploadUrl('/files/upload-url', {
      filename: file.name,
      fileSize: file.size,
      uploadType, // 'tus' or 'normal'
      type: 'content'
    });

    // Upload using the appropriate method
    let result: UploadResult;
    if (uploadData.uploadMethod === 'tus') {
      result = await this.uploadFileTus(uploadData, file, onProgress);
    } else {
      result = await this.uploadFileNormal(uploadData, file, onProgress);
    }

    return result;
  } catch (error) {
    console.error('Upload failed:', error);
    throw error;
  }
}
```
