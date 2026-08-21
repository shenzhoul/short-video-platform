---
title: Missing public paths return HTTP 404
impact: HIGH
impactDescription: Missing CDN/static paths must never look like a server outage
tags: error-handling, file-server, static-assets, 404
---

# Missing public paths return HTTP 404

## Problem

Using NestJS `ServeStaticModule` on a file/CDN host registers a SPA catch-all that calls `res.sendFile(index.html)`. When that index is missing, Express emits `ENOENT`, and a global filter that only special-cases `HttpException` turns it into HTTP 500.

## Incorrect

```typescript
ServeStaticModule.forRoot({
  rootPath: publicDir,
  serveStaticOptions: { index: false } // still registers GET * → sendFile(index.html)
});
```

## Correct

```typescript
// main.ts — NestJS recommendation for asset/CDN serving
app.useStaticAssets(publicDir, {
  index: false,
  fallthrough: true,
  redirect: false
});

// Defense in depth in the global exception filter — Express sendFile shape only:
if (
  (exception?.statusCode === 404 || exception?.status === 404)
  && (exception?.code === 'ENOENT' || String(exception?.message || '').includes('ENOENT'))
) {
  return super.catch(new NotFoundException('File not found'), host);
}
// Do not map bare fs ENOENT (no HTTP status) — that can be an upload/storage failure (500).
```

Also map storage provider "object missing" errors (`NoSuchKey`, etc.) to 404 when cloud backends are added. Downloads already use `EntityNotFoundException` / `NotFoundException`.

See `docs/features/file-server-missing-path-status-codes.md`.
