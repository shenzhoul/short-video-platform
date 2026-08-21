---
title: Implement Retry Logic
impact: MEDIUM
impactDescription: Improves success rates without user intervention
tags: error-handling, resilience, retry, network
---

## Implement Retry Logic

Implement retry logic with exponential backoff for transient network failures.

**Why**: Network failures are often temporary. Automatic retries improve success rates without user intervention.

**Retry Guidelines**:
- Max retries: 3-5 attempts
- Initial delay: 1-2 seconds
- Backoff: Exponential (2x each retry)
- Don't retry: 4xx client errors (bad request, validation)
- Do retry: 5xx server errors, network timeouts

**Incorrect (no retry logic):**

```typescript
async function badUpload(file: File) {
  const result = await fileUploadService.uploadFile('/upload', file);
  // No retry - single network blip will fail the upload
  return result;
}
```

**Correct (retry with exponential backoff):**

```typescript
async function uploadWithRetry(
  file: File,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<UploadResult | null> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Upload attempt ${attempt + 1}/${maxRetries + 1}`);

      const result = await fileUploadService.uploadFile(
        '/user/avatar/upload',
        file,
        {}
      );

      if (result.success) {
        console.log('Upload successful!');
        return result;
      }

      // Upload returned error
      lastError = new Error(result.error || 'Upload failed');

    } catch (error) {
      lastError = error;

      // Don't retry on client errors (4xx)
      if (error.status >= 400 && error.status < 500) {
        console.error('Client error, not retrying:', error.message);
        break;
      }

      // Retry on network errors and 5xx errors
      if (attempt < maxRetries) {
        const delay = initialDelay * Math.pow(2, attempt);
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // All retries failed
  toast.error(`Upload failed after ${maxRetries + 1} attempts`);
  console.error('Upload failed:', lastError);
  return null;
}
```
