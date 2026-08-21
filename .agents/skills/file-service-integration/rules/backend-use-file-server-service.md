---
title: Always Use FileServerService
impact: CRITICAL
impactDescription: Ensures proper authentication, error handling, retry logic, and type safety
tags: backend, service, integration, best-practices
---

## Always Use FileServerService

Always use FileServerService for file server integration, never make direct HTTP calls to the file server.

**Why**: FileServerService provides proper authentication, error handling, retry logic, type safety, and consistent API patterns.

**Incorrect (direct HTTP calls):**

```typescript
@Injectable()
export class BadFileController {
  constructor(private readonly httpService: HttpService) {}

  async generateUploadUrl() {
    // Don't do this - no authentication, no error handling, no type safety
    const response = await this.httpService.post(
      'http://file-server:8000/api/files/upload-url',
      { filename: 'test.jpg' }
    );
    return response.data;
  }
}
```

**Correct (use FileServerService):**

```typescript
import { FileServerService } from 'src/services/shared/file-server';

@Injectable()
@Controller('admin/settings/files')
export class SettingFileUploadController {
  constructor(private readonly fileServerService: FileServerService) {}

  @Post('image/upload')
  async generateSettingFileUploadUrl(
    @Body() body: { filename: string; fileSize: number },
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<any>> {
    const uploadData = await this.fileServerService.generateUploadUrl({
      uploadType: 'normal',
      filename: body.filename,
      fileSize: body.fileSize,
      mediaType: 'image',
      type: 'setting-file',
      acl: 'public-read',
      processingOptions: {
        generateThumbnail: false,
        generateBlurImage: false,
        imageFormat: 'webp',
        immediateProcess: true
      },
      metadata: { uploadedBy: user._id },
      createdBy: user._id
    });

    return DataResponse.ok(uploadData);
  }
}
```
