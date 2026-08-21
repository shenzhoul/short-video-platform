---
title: Set Appropriate ACL
impact: HIGH
impactDescription: Proper ACL ensures security while maintaining usability
tags: backend, security, acl, access-control
---

## Set Appropriate ACL

Set appropriate Access Control Level (ACL) based on file purpose and security requirements.

**Why**: Proper ACL configuration ensures security while maintaining usability. Public files for branding, private for sensitive data.

**ACL Guidelines**:
- `public-read`: Avatars, logos, banners, public images/videos
- `authenticated-read`: Premium content, subscriber-only media
- `private`: Documents, backups, sensitive files, personal data

**Incorrect (security issue):**

```typescript
async wrongAcl() {
  // Sensitive document as public
  return this.fileServerService.generateDocumentUploadUrl({
    type: 'private-document',
    acl: 'public-read' // SECURITY RISK!
  });
}
```

**Correct (appropriate ACL settings):**

```typescript
class ACLExamplesController {
  // Public avatars and profile images
  async uploadAvatar() {
    return this.fileServerService.generateImageUploadUrl({
      type: 'avatar',
      acl: 'public-read' // Anyone can view without auth
    });
  }

  // Site logos and branding
  async uploadSiteLogo() {
    return this.fileServerService.generateImageUploadUrl({
      type: 'setting-file',
      acl: 'public-read' // Publicly accessible branding
    });
  }

  // Premium content for subscribers
  async uploadPremiumVideo() {
    return this.fileServerService.generateVideoUploadUrl({
      type: 'premium-content',
      acl: 'authenticated-read' // Requires authentication
    });
  }

  // Private documents and sensitive files
  async uploadPrivateDoc() {
    return this.fileServerService.generateDocumentUploadUrl({
      type: 'private-document',
      acl: 'private' // Only owner can access
    });
  }

  // User backups and exports
  async uploadBackup() {
    return this.fileServerService.generateUploadUrl({
      mediaType: 'file',
      type: 'backup',
      acl: 'private' // User data, private access
    });
  }
}
```
