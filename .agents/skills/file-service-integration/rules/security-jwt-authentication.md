---
title: Use JWT Authentication
impact: HIGH
impactDescription: Secure, time-limited, user-specific tokens
tags: security, authentication, jwt, tokens
---

## Use JWT Authentication

Always use JWT tokens for upload authentication, never use plain API keys in client-side code.

**Why**: JWT tokens are time-limited, user-specific, and can be safely used in client-side applications. API keys would expose system credentials.

**Incorrect (exposing API key):**

```typescript
const API_KEY = 'secret-api-key'; // NEVER do this!

async function badUpload(file: File) {
  const formData = new FormData();
  formData.append('file', file);

  await fetch('/upload', {
    headers: {
      'X-API-Key': API_KEY // SECURITY RISK!
    },
    body: formData
  });
}
```

**Correct (JWT token authentication):**

```typescript
// Backend generates JWT token
@Post('upload-url')
async generateUploadUrl(
  @Body() body: { filename: string },
  @CurrentUser() user: AuthUserDto
) {
  // FileServerService generates JWT token internally
  const uploadData = await this.fileServerService.generateUploadUrl({
    filename: body.filename,
    type: 'content',
    metadata: { uploadedBy: user._id },
    createdBy: user._id // JWT will be scoped to this user
  });

  // uploadData contains JWT token for upload
  return DataResponse.ok(uploadData);
}

// Frontend receives token and uses it for upload
async function uploadFile(file: File) {
  // Get upload URL with JWT token
  const response = await fetch('/api/files/upload-url', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${userJwtToken}`, // User auth
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ filename: file.name })
  });

  const uploadData = await response.json();

  // Upload using the token from response
  const formData = new FormData();
  formData.append('token', uploadData.token); // JWT token from backend
  formData.append('file', file);

  await fetch(uploadData.uploadUrl, {
    method: 'POST',
    body: formData
  });
}
```
