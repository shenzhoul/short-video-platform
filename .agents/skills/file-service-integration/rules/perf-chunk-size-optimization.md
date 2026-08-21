---
title: Optimize Chunk Size
impact: MEDIUM
impactDescription: Balances speed and reliability for uploads
tags: performance, tus, chunking, optimization
---

## Optimize Chunk Size

Use optimal chunk sizes for TUS uploads (5MB recommended) to balance speed and reliability.

**Why**: Small chunks increase overhead, large chunks risk failure. 5MB chunks provide optimal balance.

**Chunk Size Guidelines**:
- **Small files (< 10MB)**: 1MB chunks
- **Medium files (10-100MB)**: 5MB chunks
- **Large files (> 100MB)**: 10MB chunks
- **Factor in**: Connection speed, file stability requirements
- **Default**: 5MB is safe for most use cases

**Incorrect (inappropriate chunk sizes):**

```typescript
const badUpload1 = new tus.Upload(file, {
  chunkSize: 100 * 1024, // Too small - excessive overhead
  endpoint: uploadUrl
});

const badUpload2 = new tus.Upload(file, {
  chunkSize: 50 * 1024 * 1024, // Too large - high failure risk
  endpoint: uploadUrl
});
```

**Correct (optimal chunk size):**

```typescript
const upload = new tus.Upload(file, {
  endpoint: uploadData.tusUploadUrl,
  chunkSize: 5 * 1024 * 1024, // ✅ 5MB chunks (optimal)

  headers: {
    'Authorization': `Bearer ${uploadData.token}`
  },

  onProgress: (bytesUploaded, bytesTotal) => {
    const percentage = Math.round((bytesUploaded / bytesTotal) * 100);
    setProgress(percentage);
  },

  onSuccess: () => {
    console.log('Upload completed');
  }
});

upload.start();

// Adjust chunk size based on file size and connection
function getOptimalChunkSize(fileSize: number, connectionSpeed: number): number {
  if (fileSize < 10 * 1024 * 1024) {
    // Small files: 1MB chunks
    return 1 * 1024 * 1024;
  } else if (fileSize < 100 * 1024 * 1024) {
    // Medium files: 5MB chunks
    return 5 * 1024 * 1024;
  } else {
    // Large files: 10MB chunks
    return 10 * 1024 * 1024;
  }
}
```
