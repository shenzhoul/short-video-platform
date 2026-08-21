---
title: Validate Before Upload
impact: MEDIUM
impactDescription: Saves bandwidth and improves UX with instant feedback
tags: frontend, validation, ux, performance
---

## Validate Before Upload

Validate file size, type, and other constraints client-side before uploading.

**Why**: Client-side validation provides instant feedback, saves bandwidth, and improves UX by catching errors before upload starts.

**Validation Guidelines**:
- **Images**: Max 100MB, types: image/jpeg, image/png, image/webp
- **Videos**: Max 1GB, types: video/mp4, video/avi, video/mov
- **Documents**: Max 100MB, types: application/pdf, text/plain
- **Always validate**: File size, MIME type, extension
- **Show specific errors**: Help users understand what went wrong

**Incorrect (no validation):**

```typescript
async function badUpload(file: File) {
  // Uploading without validation - might fail or violate server rules
  const result = await fileUploadService.uploadFile('/upload', file);
  return result;
}
```

**Correct (client-side validation):**

```typescript
interface FileValidationRules {
  maxSize: number; // bytes
  allowedTypes: string[]; // MIME types
  allowedExtensions?: string[];
}

function validateFile(file: File, rules: FileValidationRules): string | null {
  // Check file size
  if (file.size > rules.maxSize) {
    const maxSizeMB = rules.maxSize / (1024 * 1024);
    return `File size exceeds ${maxSizeMB}MB limit`;
  }

  // Check file type
  if (!rules.allowedTypes.includes(file.type)) {
    return `File type ${file.type} is not allowed`;
  }

  // Check file extension (optional)
  if (rules.allowedExtensions) {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!extension || !rules.allowedExtensions.includes(extension)) {
      return `File extension .${extension} is not allowed`;
    }
  }

  return null; // Valid
}

async function uploadAvatar(file: File) {
  // Validate before upload
  const validationError = validateFile(file, {
    maxSize: 10 * 1024 * 1024, // 10MB
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
    allowedExtensions: ['jpg', 'jpeg', 'png', 'webp']
  });

  if (validationError) {
    toast.error(validationError);
    return null;
  }

  // Proceed with upload
  const result = await fileUploadService.uploadFile(
    '/user/avatar/upload',
    file
  );

  return result;
}

// React hook example
export function useFileValidation(rules: FileValidationRules) {
  const [error, setError] = useState<string | null>(null);

  const validateAndUpload = async (file: File, endpoint: string) => {
    const validationError = validateFile(file, rules);

    if (validationError) {
      setError(validationError);
      return null;
    }

    setError(null);
    return await fileUploadService.uploadFile(endpoint, file);
  };

  return { validateAndUpload, error };
}
```
