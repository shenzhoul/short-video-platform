---
title: Provide Progress Tracking
impact: HIGH
impactDescription: Improves UX and reduces user anxiety
tags: frontend, progress, ux, feedback
---

## Provide Progress Tracking

Provide progress callbacks for better user experience during uploads.

**Why**: Users need visual feedback for long-running operations. Progress tracking improves perceived performance and reduces user anxiety.

**Incorrect (no progress feedback):**

```typescript
async function badUpload(file: File) {
  const result = await fileUploadService.uploadFile(
    '/upload',
    file,
    {}
    // Missing progress callback - user has no feedback!
  );
  return result;
}
```

**Correct (progress tracking with UI feedback):**

```typescript
import { useState } from 'react';
import { fileUploadService } from '@/services/file-upload.service';

export function useFileUpload() {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const uploadFile = async (
    endpoint: string,
    file: File
  ): Promise<UploadResult | null> => {
    try {
      setUploading(true);
      setProgress(0);
      setError(null);

      const result = await fileUploadService.uploadFile(
        endpoint,
        file,
        {},
        (progressData) => {
          // Update progress state for UI
          setProgress(progressData.percentage);

          // Optional: Show estimated time remaining
          if (progressData.timeRemaining) {
            console.log(`Time remaining: ${progressData.timeRemaining}s`);
          }
        }
      );

      if (!result.success) {
        setError(result.error || 'Upload failed');
        return null;
      }

      setProgress(100);
      return result;
    } catch (error) {
      setError(error.message);
      return null;
    } finally {
      setUploading(false);
    }
  };

  return { uploadFile, uploading, progress, error };
}

// Usage in component
function UploadComponent() {
  const { uploadFile, uploading, progress, error } = useFileUpload();

  const handleFileSelect = async (file: File) => {
    const result = await uploadFile('/user/avatar/upload', file);
    if (result) {
      console.log('Upload successful:', result.fileId);
    }
  };

  return (
    <>
      <input type="file" onChange={(e) => handleFileSelect(e.target.files[0])} />
      {uploading && (
        <div>
          <progress value={progress} max={100} />
          <span>{progress}%</span>
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </>
  );
}
```
