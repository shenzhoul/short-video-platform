---
title: Provide Meaningful Error Messages
impact: MEDIUM
impactDescription: Reduces support burden and improves user satisfaction
tags: error-handling, ux, messages, user-feedback
---

## Provide Meaningful Error Messages

Provide user-friendly, actionable error messages that guide users to resolution.

**Why**: Technical error messages confuse users. Clear, actionable messages improve UX and reduce support burden.

**Error Message Guidelines**:
- Be specific about the problem
- Suggest actionable solutions
- Avoid technical jargon
- Include contact info for unresolvable errors
- Log technical details separately for debugging

**Incorrect (raw error messages):**

```typescript
async function badUpload(file: File) {
  try {
    return await fileUploadService.uploadFile('/upload', file);
  } catch (error) {
    // Showing technical error to user
    toast.error(error.message); // "ERR_CONNECTION_REFUSED" - not helpful!
    return null;
  }
}
```

**Correct (user-friendly error messages):**

```typescript
function getUploadErrorMessage(error: any): string {
  // File size errors
  if (error.status === 413 || error.message.includes('size')) {
    return 'File is too large. Please choose a file under 100MB.';
  }

  // File type errors
  if (error.status === 415 || error.message.includes('type')) {
    return 'File type not supported. Please upload a JPEG, PNG, or WebP image.';
  }

  // Authentication errors
  if (error.status === 401) {
    return 'Your session has expired. Please log in again and try uploading.';
  }

  // Permission errors
  if (error.status === 403) {
    return 'You don\'t have permission to upload files. Please contact support.';
  }

  // Network errors
  if (error.message.includes('network') || error.message.includes('timeout')) {
    return 'Network error. Please check your internet connection and try again.';
  }

  // Server errors
  if (error.status >= 500) {
    return 'Server error. Our team has been notified. Please try again later.';
  }

  // Generic fallback
  return 'Upload failed. Please try again or contact support if the problem persists.';
}

// Usage
async function uploadFile(file: File) {
  try {
    const result = await fileUploadService.uploadFile('/upload', file);

    if (!result.success) {
      const message = getUploadErrorMessage({ message: result.error });
      toast.error(message);
      return null;
    }

    return result;
  } catch (error) {
    const message = getUploadErrorMessage(error);
    toast.error(message);
    return null;
  }
}
```
