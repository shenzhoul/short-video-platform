---
title: Validate File Types
impact: HIGH
impactDescription: Prevents malicious uploads and security vulnerabilities
tags: security, validation, file-types, malicious
---

## Validate File Types

Validate file MIME types on both client and server to prevent malicious uploads.

**Why**: Client-side validation can be bypassed. Server-side validation ensures only allowed file types reach storage.

**Allowed File Types**:
- **Images**: JPEG, PNG, WebP, GIF, HEIC, HEIF
- **Videos**: MP4, AVI, MOV, WMV, WebM
- **Documents**: PDF, DOC, DOCX, TXT
- **Archives**: ZIP (only for specific use cases)
- **Never allow**: EXE, BAT, SH, JS, PHP, HTML

**Incorrect (no server validation):**

```typescript
@Post('upload-url')
async badUploadUrl(@Body() body: { filename: string }) {
  // Accepting any file type - SECURITY RISK!
  return this.fileServerService.generateUploadUrl({
    filename: body.filename
    // No validation - could upload malicious files
  });
}
```

**Correct (client and server validation):**

```typescript
// Client-side validation (Frontend)
function validateFileType(file: File, allowedTypes: string[]): boolean {
  if (!allowedTypes.includes(file.type)) {
    throw new Error(`File type ${file.type} is not allowed`);
  }

  // Additional extension check
  const extension = file.name.split('.').pop()?.toLowerCase();
  const allowedExtensions = allowedTypes.map(type =>
    type.split('/')[1]
  );

  if (!allowedExtensions.includes(extension || '')) {
    throw new Error(`File extension .${extension} is not allowed`);
  }

  return true;
}

// Server-side validation (Backend)
@Post('upload-url')
async generateUploadUrl(
  @Body() body: { filename: string },
  @CurrentUser() user: AuthUserDto
) {
  // Validate file extension on server
  const extension = body.filename.split('.').pop()?.toLowerCase();
  const allowedExtensions = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

  if (!extension || !allowedExtensions.includes(extension)) {
    throw new HttpException(
      `File type .${extension} is not allowed`,
      HttpStatus.BAD_REQUEST
    );
  }

  // Check file type from filename
  const mimeType = this.getMimeType(extension);
  const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ];

  if (!allowedMimeTypes.includes(mimeType)) {
    throw new HttpException(
      `MIME type ${mimeType} is not allowed`,
      HttpStatus.UNSUPPORTED_MEDIA_TYPE
    );
  }

  // Generate upload URL
  return this.fileServerService.generateImageUploadUrl({
    filename: body.filename,
    type: 'avatar',
    acl: 'public-read'
  });
}
```
