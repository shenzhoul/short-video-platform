---
title: Use API-Returned File URLs In Browser Apps
impact: HIGH
impactDescription: Keeps file-server internal APIs server-only and aligns browser caching with file-sw.js
tags: frontend, media, caching, service-worker, security
---

## Use API-Returned File URLs In Browser Apps

Browser clients must render or cache the file URL already returned by the API. Do not call file-server internal endpoints such as `/internal/files/sign-url` or `/internal/files/sign-urls` from `user/` or `admin/`.

**Why**: Those internal endpoints exist for trusted server-to-server calls. The API layer is responsible for returning the full access URL, and the browser should use `public/file-sw.js` to cache expiring media responses when needed.

**Incorrect (browser re-signs file URLs through internal endpoint):**

```typescript
export class FileCacheService extends APIRequest {
  async getFreshSignedUrl(fileId: string) {
    const response = await this.post('/internal/files/sign-url', {
      fileId,
      expiresIn: 3600
    });

    return response.data.url;
  }
}
```

**Correct (browser uses the current API-returned URL and lets file-sw.js cache it):**

```typescript
export class FileCacheService {
  async getCachedFile(url?: string | null) {
    if (!url) return null;

    const cached = await this.isCached(url);
    if (!cached) {
      await this.preloadFiles([url]);
    }

    return url;
  }
}
```
