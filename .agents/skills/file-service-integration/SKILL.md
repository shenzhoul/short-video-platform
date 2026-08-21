---
name: file-service-integration
description: End-to-end upload and media-processing workflow for Douyin Clone across api, file-server, user, and admin. Use for signed uploads, TUS resumable uploads, file ownership, image/video processing, or API media references.
---

# File Service Integration

Trace the complete flow before changing it:

1. the client requests an upload target from the API;
2. the API delegates to `FileServerService`;
3. the client uploads directly or through TUS;
4. the file server stores metadata and runs image/video processing;
5. the API validates ownership before attaching a file to identity or content;
6. API DTOs return the media data consumed by the frontend.

## Current References

- `api/src/services/shared/file-server/file-server.service.ts`
- `api/src/controllers/content/content-file.controller.ts`
- `api/src/services/identity/identity.file.service.ts`
- `api/src/services/content/content.file.service.ts`
- `file-server/src/controllers/internal/`
- `file-server/src/services/file/`
- `file-server/src/services/tus/`
- `user/src/services/file-upload.service.ts`
- `user/src/hooks/use-file-upload-server.ts`
- `admin/src/services/file-upload.service.ts`

## Invariants

- Validate type, size, ownership, and intended use on the server.
- Use TUS for resumable/large uploads and preserve upload progress and recovery behavior.
- In Next.js frontend services, load `tus-js-client` dynamically inside the browser upload operation. A static import can pull its Node lockfile dependency into the dev-server HMR graph, repeatedly register process signal listeners, and trigger `MaxListenersExceededWarning` after many recompilations. Do not mask that leak with `process.setMaxListeners()`.
- Persist file references only after the owning entity is successfully saved.
- Use API-returned URLs and metadata rather than constructing storage paths in the frontend.
- Keep image work with Sharp and video work with the current FFmpeg/BullMQ flow.
- Clean abandoned drafts and unused uploads through the existing jobs.
- Never expose internal signing secrets or storage paths.
- Never authenticate an internal or administrative file-server route with a JWT verified against `JWT_SECRET`. That same secret signs the upload, TUS, and signed-URL tokens handed to browsers, so "the signature is valid" means "some user is uploading", not "the API is calling". `/internal/files/*` takes service API keys only — `InternalApiGuard` requires `X-API-Key` (`API_SECRET_KEY`) plus `X-Internal-API-Key` (`INTERNAL_API_KEY`), compared in constant time. This was a live critical defect until 2026-08-22; the guard it replaced checked nothing but the signature.
- Every issued token carries a `purpose` claim — `file-upload`, `tus-upload`, `signed-url` — and the consuming path verifies it. Do not distinguish token families by which fields happen to be present.
- Signing secrets have no fallback value. `getFileSigningSecret()` throws when `JWT_SECRET` is unset rather than signing with a default; a literal key in a public repo is a published key.
- Post-video uploads generate three normal thumbnail recommendations. Keep short-video extraction at three frames and do not substitute `blurImage` for a creator-selected cover.
- Custom post covers are independent owned file references for `4:3` and `3:4`; include both in ownership updates and deletion cleanup.
- Multi-image graphic drafts mirror video drafts: upload `post-photo` files before post creation, persist only creator-scoped file IDs and editor metadata in browser storage, restore through an authenticated ownership-checked API, and batch-discard only unreferenced owned files. Reordering or selecting a cover must not duplicate the physical file.
- Validate processed draft media with durable record fields such as the top-level `type`. Do not require upload-request metadata like `category` or `fileType`, because processing normalization may remove those fields.
- Disk cleanup must canonicalize and deduplicate absolute/public path aliases before unlinking. Retry transient Windows `EBUSY`, `EPERM`, and `EACCES` errors, and propagate exhausted deletion failures so the queue can retry instead of orphaning media.
- After transcoding to a distinct browser-compatible video, persist the final output reference before deleting the superseded source. Compare canonical source/output paths rather than the upload record path, and constrain hardware-encoder bitrate or quality so compatibility conversion cannot expand files without a bound.
- When discard races queued or active media processing, atomically tombstone the record and let the worker that owns FFmpeg/Sharp handles perform physical cleanup and hard-delete the tombstone. Workers must reject writes to deleted records and make both the pre-claim and post-processing discard paths idempotent.
- Keep Sharp/libvips file-descriptor caching disabled in the file-server process on Windows-compatible deployments. Reading generated thumbnail metadata by path can otherwise retain permanent handles and make every physical deletion retry end in `EBUSY`; memory and operation caches may remain enabled.

## Bundled Rules

Read only the relevant files under `rules/` for security, processing, frontend, performance, or error-handling details. Verify every referenced path against the current repository before applying an example.

## Verification

- Cover direct upload, resumable upload, invalid type/size, unauthorized attachment, interrupted upload, processing failure, and cleanup.
- Run verification for every touched app.
