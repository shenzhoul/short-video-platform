---
title: File Uploads and Processing
description: Authorized direct/TUS uploads, ownership references, disk storage, and media processing.
audience: [creator, admin, operator, developer-agent]
domain: file-service
status: active
updated: 2026-08-03
tags: [upload, tus, image, video, ffmpeg]
---

# File Uploads and Processing

## Workflow

1. The user/admin client requests an upload URL through a domain API endpoint.
2. The API asks the file server for a direct or TUS upload location with signed context.
3. The client uploads to the file server and receives file metadata/ID.
4. A profile, post, or setting mutation validates ownership and persists the reference.
5. Queue listeners/processors handle media work and unused-file cleanup.

Images use Sharp. Videos use FFmpeg/FFprobe and optional hardware acceleration. Large processing work can run through BullMQ.

Post videos request three WebP thumbnails. FFmpeg extracts all three at evenly spaced timestamps even for videos shorter than three seconds. These are normal thumbnails used as creator cover recommendations; the separately generated `blurImage` remains a media fallback and must not be treated as a post cover.

`StorageService` currently selects `DiskStorageService`; S3/CDN configuration placeholders do not provide a cloud-storage adapter.

See [the file-service domain](../domains/file-service.md) for internal routes and production secret requirements.
