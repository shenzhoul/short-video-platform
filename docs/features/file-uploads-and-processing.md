---
title: File Uploads and Processing
description: Authorized direct/TUS uploads, ownership references, disk storage, and media processing.
audience: [creator, admin, operator, developer-agent]
domain: file-service
status: active
updated: 2026-08-19
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

## Message attachments

`POST /content/files/message/photo/upload` and `POST /content/files/message/video/upload` issue upload URLs for direct-message attachments, with types `message-photo` and `message-video`.

They are deliberately separate from the post upload endpoints rather than reused. The post endpoints gate on creator document verification, which is correct for published content and wrong for a private message — anyone able to hold a conversation must be able to send a picture in it. They also generate a `blurImage`, which a direct message has no use for, since both participants may see the attachment in full.

The message is created only after the upload returns a file id, so a message row can never reference an incomplete upload. Abandoned uploads are not yet swept; see `.agents/bug-tracker/rec-api-message-file-gc.md`.

`StorageService` currently selects `DiskStorageService`; S3/CDN configuration placeholders do not provide a cloud-storage adapter.

See [the file-service domain](../domains/file-service.md) for internal routes and production secret requirements.
