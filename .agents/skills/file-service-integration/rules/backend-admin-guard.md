---
title: Protect Admin Endpoints
impact: HIGH
impactDescription: Prevents unauthorized access to system files
tags: backend, security, authorization, admin
---

## Protect Admin Endpoints

Protect admin file management endpoints with `@Roles('admin')` and `@UseGuards(RoleGuard)`.

**Why**: File management operations (especially system files) should be restricted to administrators to prevent unauthorized access and modification.

**Incorrect (missing admin protection):**

```typescript
@Controller('admin/system-files')
export class BadAdminController {
  @Post('upload')
  // Missing @Roles('admin') and @UseGuards(RoleGuard)
  async uploadSystemFile() {
    // SECURITY RISK! Any user can upload system files
    return this.fileServerService.generateUploadUrl({...});
  }
}
```

**Correct (protected admin endpoints):**

```typescript
@Injectable()
@Controller('admin/settings/files')
@ApiTags('Admin Setting Files')
@ApiSecurity('token-auth')
export class SettingFileUploadController {
  @Post('image/upload')
  @Roles('admin') // ✅ Admin role required
  @UseGuards(RoleGuard) // ✅ Guard enforces role
  async generateSettingFileUploadUrl(
    @Body() body: { filename: string; fileSize: number },
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<any>> {
    // Only admins can reach this code
    return this.fileServerService.generateUploadUrl({...});
  }

  @Delete(':fileId')
  @Roles('admin')
  @UseGuards(RoleGuard)
  async deleteSettingFile(
    @Param('fileId') fileId: string
  ): Promise<DataResponse<void>> {
    await this.fileServerService.deleteFile(fileId);
    return DataResponse.ok();
  }
}

// User endpoints - authenticated but not admin
@Controller('user/files')
export class UserFileController {
  @Post('avatar/upload')
  @UseGuards(AuthGuard) // ✅ Regular auth, no admin required
  async uploadAvatar(
    @CurrentUser() user: AuthUserDto,
    @Body() body: { filename: string }
  ): Promise<DataResponse<any>> {
    // Any authenticated user can upload avatar
    return this.fileServerService.generateImageUploadUrl({...});
  }
}
```
