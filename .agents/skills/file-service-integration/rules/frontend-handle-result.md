---
title: Check Success and Handle Errors
impact: HIGH
impactDescription: Improves UX and enables error recovery
tags: frontend, error-handling, validation, ux
---

## Check Success and Handle Errors

Always check the `success` flag in upload results and handle errors appropriately.

**Why**: Upload operations can fail for many reasons (network, validation, server errors). Proper error handling improves UX and enables recovery.

**Incorrect (ignoring success flag):**

```typescript
async badUpload(file: File) {
  const result = await fileUploadService.uploadFile('/upload', file);

  // Assuming success without checking!
  await updateUserAvatar(result.fileId); // Might be undefined
  toast.success('Upload successful!'); // Might have actually failed

  return result;
}
```

**Correct (comprehensive result handling):**

```typescript
async uploadAvatar(file: File) {
  try {
    const result = await fileUploadService.uploadFile(
      '/user/avatar/upload',
      file,
      {},
      (progress) => setProgress(progress.percentage)
    );

    // Check success flag
    if (!result.success) {
      // Handle upload failure
      const errorMessage = result.error || 'Upload failed';
      toast.error(errorMessage);

      // Log for debugging
      console.error('Upload failed:', {
        fileId: result.fileId,
        error: result.error,
        fileName: file.name
      });

      return null;
    }

    // Success! Use the file information
    console.log('Upload successful:', {
      fileId: result.fileId,
      url: result.fileInfo?.url
    });

    // Update user profile with new avatar URL
    await updateUserAvatar(result.fileId);

    toast.success('Avatar uploaded successfully!');
    return result;

  } catch (error) {
    // Handle unexpected errors
    console.error('Unexpected upload error:', error);
    toast.error('An unexpected error occurred during upload');
    return null;
  }
}
```
