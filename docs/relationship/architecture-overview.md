---
title: Relationship Architecture Overview
description: Cross-application dependencies and ownership boundaries.
audience: [operator, developer-agent]
domain: cross
status: active
updated: 2026-07-31
tags: [architecture, dependencies, data-flow]
---

# Relationship Architecture Overview

```mermaid
flowchart LR
  Guest["Guest browser"] --> User["user/ Next.js"]
  Member["Authenticated user"] --> User
  Operator["Admin"] --> Admin["admin/ Next.js"]
  User --> API["api/ NestJS"]
  Admin --> API
  API --> Mongo[("API MongoDB")]
  API --> Redis[("Redis")]
  API --> Queue["BullMQ"]
  API --> Files["file-server/ NestJS"]
  Files --> FileMongo[("File metadata MongoDB")]
  Files --> FileQueue["BullMQ"]
  Files --> Disk["Disk storage"]
  User <--> Socket["Socket.IO"]
  Socket <--> API
```

## Ownership

- `user/` and `admin/` own rendering, session integration, client state, and API clients.
- `api/` owns identity, content, community, system behavior, authorization, and cross-domain orchestration.
- `file-server/` owns upload transport, file metadata, disk I/O, and image/video processing.
- MongoDB stores durable records; Redis/BullMQ supports cache, throttling, events, scheduled cleanup, and presence coordination.

There is no current Docker build/deployment stack. Add one only with complete application Dockerfiles, environment templates, supporting scripts, and validated compose configuration.

See [top-level architecture](../architecture.md) for package versions, ports, and persistence details.
