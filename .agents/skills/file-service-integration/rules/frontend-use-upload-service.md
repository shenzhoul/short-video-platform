---
title: Use FileUploadService
impact: HIGH
impactDescription: Provides consistent API, progress tracking, and error handling
tags: frontend, service, upload, best-practices
---

## Use FileUploadService

Use FileUploadService for all file uploads, never implement custom upload logic.

**Why**: FileUploadService provides consistent API, progress tracking, error handling, retry logic, and supports both TUS and normal uploads.

**Incorrect (custom upload implementation):**

```typescript
export class BadSettingService extends APIRequest {
  async badUploadFile(file: File) {
    // Don't reimplement upload logic!
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/upload', {
      method: 'POST',
      body: formData
    });

    return response.json();
    // Missing: progress tracking, error handling, retry logic, TUS support
  }
}
```

**Correct (use FileUploadService):**

```typescript
import { fileUploadService } from './file-upload.service';

export class SettingService extends APIRequest {
  async uploadFile(file: File, onProgress?: (progress: number) => void) {
    try {
      const result = await fileUploadService.uploadFile(
        '/admin/settings/files/image/upload', // Upload URL endpoint
        file,
        {}, // Additional options
        onProgress ? (progress) => onProgress(progress.percentage) : undefined
      );

      if (!result.success) {
        throw new Error(result.error || 'Upload failed');
      }

      return result;
    } catch (error) {
      console.error('Upload error:', error);
      throw error;
    }
  }
}
```
