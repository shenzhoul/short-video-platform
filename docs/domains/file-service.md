---
title: File Service Domain
description: Upload authorization, disk storage, file metadata, ownership, and media processing.
audience: [creator, admin, operator, developer-agent]
domain: file-service
status: active
updated: 2026-07-31
tags: [upload, tus, image, video, storage]
---

# File Service Domain

## Responsibilities

The API owns business-specific upload intent and file references. The separate file server owns upload transport, file metadata, validation, disk storage, and media processing.

Supported upload transports are direct multipart upload and TUS resumable upload. User/admin clients first request an authorized upload location through the API, upload to the file server, then pass returned file IDs into profile/post/settings mutations.

## Processing

- Images use Sharp-based validation and processing.
- Videos use FFmpeg/FFprobe, with thumbnails and configurable hardware acceleration.
- Larger work can be queued through BullMQ.
- Cleanup jobs remove unused or failed temporary files after configured grace periods.

## Storage

`StorageService` currently selects `DiskStorageService`; external links can pass through. S3/CDN adapters are TODOs and must not be documented as available storage backends.

## Internal routes

The file server exposes internal endpoints for direct/TUS upload URLs, file lookup, ownership/reference updates, batch deletion, and unused-file cleanup. These routes require API/internal credentials and are not public client APIs.

## Required production secrets

Configure matching API/file-server values for the API key, internal API key, and JWT secret. Also configure MongoDB, Redis/BullMQ, CORS, public/base URLs, upload directories, size limits, and FFmpeg paths as appropriate. Do not use the development fallback secrets in production.
