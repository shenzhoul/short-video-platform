---
title: Wrap Uploads in Try-Catch
impact: MEDIUM
impactDescription: Improves UX and enables debugging
tags: error-handling, resilience, ux, debugging
---

## Wrap Uploads in Try-Catch

Wrap all upload operations in try-catch blocks with proper error handling and user feedback.

**Why**: Uploads can fail for many reasons (network, validation, server errors). Proper error handling improves UX and enables debugging.

**Incorrect (no error handling):**

```typescript
async badUpload(file: File) {
  const uploadData = await fileUploadService.getUploadUrl('/upload', {
    filename: file.name
  });

  const result = await fileUploadService.uploadFile(uploadData.uploadUrl, file);
  // No error handling - will crash on any error!

  return result;
}
```

**Correct (comprehensive error handling):**

```typescript
async uploadFile(file: File) {
  try {
    // Step 1: Get upload URL
    const uploadData = await fileUploadService.getUploadUrl(
      '/user/avatar/upload',
      {
        filename: file.name,
        fileSize: file.size
      }
    );

    // Step 2: Upload file
    const result = await fileUploadService.uploadFile(
      uploadData.uploadUrl,
      file,
      {},
      (progress) => setProgress(progress.percentage)
    );

    if (!result.success) {
      throw new Error(result.error || 'Upload failed');
    }

    // Success!
    toast.success('File uploaded successfully!');
    return result;

  } catch (error) {
    // Handle specific error types
    if (error.status === 401) {
      toast.error('Session expired. Please log in again.');
      redirectToLogin();
    } else if (error.status === 413) {
      toast.error('File is too large. Please choose a smaller file.');
    } else if (error.status === 415) {
      toast.error('File type is not supported. Please choose a different file.');
    } else if (error.message.includes('network')) {
      toast.error('Network error. Please check your connection and try again.');
    } else {
      toast.error(`Upload failed: ${error.message}`);
    }

    // Log for debugging
    console.error('Upload failed:', {
      fileName: file.name,
      fileSize: file.size,
      error: error.message,
      status: error.status
    });

    return null;
  }
}
```
