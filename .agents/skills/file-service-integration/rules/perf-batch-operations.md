---
title: Use Batch Operations
impact: MEDIUM
impactDescription: Reduces network overhead and improves performance
tags: performance, batch, optimization, api
---

## Use Batch Operations

Use batch endpoints for deleting or downloading multiple files to reduce API calls.

**Why**: Batch operations reduce network overhead, improve performance, and provide atomic transactions.

**Incorrect (individual API calls):**

```typescript
async function badBatchDelete(fileIds: string[]) {
  // Don't loop and delete one by one!
  for (const fileId of fileIds) {
    await fileServerService.deleteFile(fileId);
    // Multiple API calls - slow and inefficient
  }
}
```

**Correct (batch operations):**

```typescript
// Batch delete
async function deleteMultipleFiles(fileIds: string[]) {
  try {
    const result = await fileServerService.deleteMultipleFiles(fileIds);

    console.log(`Deleted ${result.deleted} files`);

    if (result.errors.length > 0) {
      console.error('Some deletions failed:', result.errors);
    }

    toast.success(`Deleted ${result.deleted} files`);
    return result;

  } catch (error) {
    console.error('Batch delete failed:', error);
    toast.error('Failed to delete files');
    return null;
  }
}

// Batch download URLs
async function generateMultipleDownloadUrls(fileIds: string[]) {
  try {
    const urls = await fileServerService.generateMultipleDownloadUrls(
      fileIds,
      {
        expiresIn: 3600, // 1 hour
        download: true
      }
    );

    return urls;
  } catch (error) {
    console.error('Failed to generate download URLs:', error);
    return [];
  }
}
```
