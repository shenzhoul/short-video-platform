---
title: Use TUS for Resume Capability
impact: MEDIUM
impactDescription: Prevents data loss on network interruptions
tags: error-handling, tus, resumable, resilience
---

## Use TUS for Resume Capability

Use TUS resumable uploads for large files to automatically resume on network failure.

**Why**: TUS protocol enables resuming interrupted uploads, preventing data loss and improving success rates for large files.

**TUS Guidelines**:
- Use TUS for files > 10MB
- Enable `storeFingerprintForResuming` for resume capability
- Configure appropriate chunk size (5MB recommended)
- Set retry delays for transient failures
- Clear fingerprints on success to prevent stale data

**Incorrect (normal upload for large file):**

```typescript
async function badLargeUpload(file: File) {
  // Using normal upload for large file - will fail on network interruption
  const uploadData = await fileUploadService.getUploadUrl('/upload', {
    filename: file.name,
    uploadType: 'normal' // Wrong for large files!
  });

  // If network fails during upload, user must restart from beginning
  return await fileUploadService.uploadFileNormal(uploadData, file);
}
```

**Correct (TUS with resume capability):**

```typescript
import * as tus from 'tus-js-client';

async function uploadLargeFile(file: File) {
  // Get TUS upload URL
  const uploadData = await fileUploadService.getUploadUrl(
    '/files/upload',
    {
      filename: file.name,
      fileSize: file.size,
      uploadType: 'tus' // Use TUS for resumable upload
    }
  );

  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: uploadData.tusUploadUrl,
      retryDelays: [0, 1000, 3000, 5000], // Retry delays
      chunkSize: 5 * 1024 * 1024, // 5MB chunks

      headers: {
        'Authorization': `Bearer ${uploadData.token}`
      },

      metadata: {
        filename: file.name,
        filetype: file.type,
        fileId: uploadData.fileId
      },

      // ✅ Enable resume functionality
      storeFingerprintForResuming: true,
      removeFingerprintOnSuccess: true,

      onProgress: (bytesUploaded, bytesTotal) => {
        const percentage = Math.round((bytesUploaded / bytesTotal) * 100);
        console.log(`Upload progress: ${percentage}%`);
        setProgress(percentage);
      },

      onSuccess: () => {
        console.log('Upload completed successfully');
        toast.success('File uploaded successfully!');
        resolve({
          success: true,
          fileId: uploadData.fileId
        });
      },

      onError: (error) => {
        console.error('Upload error:', error);
        toast.error(`Upload failed: ${error.message}`);
        reject(error);
      }
    });

    // Start upload (will auto-resume if interrupted)
    upload.start();
  });
}
```
