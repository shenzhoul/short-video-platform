---
title: Documentation Index
description: Maintained map of the current Douyin Clone documentation.
audience: [developer-agent]
domain: cross
status: active
updated: 2026-09-06
tags: [index, documentation]
---

# Documentation Index

The project's public entry point is the [root README](../README.md). This index is the map of the
maintained documentation behind it.

| Document | Purpose |
|---|---|
| [README.md](./README.md) | Scope and entry points |
| [highlights.md](./highlights.md) | Verified product and technical highlights |
| [architecture.md](./architecture.md) | System architecture and runtime dependencies |
| [deployment/README.md](./deployment/README.md) | **Production setup**: one GCE VM + Cloudflare R2/Worker — architecture, env matrix, first-time runbook, cost and backup |
| [deployment/routine-deploys.md](./deployment/routine-deploys.md) | **Shipping a commit**: which image to rebuild, which service to recreate, verification, rollback, cheat sheet |
| [deployment/free-tier-feasibility.md](./deployment/free-tier-feasibility.md) | Historical: the Render Free study whose measurements set the current memory limits |
| [by-pages/README.md](./by-pages/README.md) | Implemented user/admin routes |
| [features/README.md](./features/README.md) | Implemented feature index |
| [features/authentication.md](./features/authentication.md) | Credentials authentication |
| [features/creator-profiles.md](./features/creator-profiles.md) | Public and self-managed profiles |
| [features/post-publishing.md](./features/post-publishing.md) | Text/photo/video publishing |
| [features/feeds-and-recommendations.md](./features/feeds-and-recommendations.md) | Home, profile, and recommended feeds |
| [features/search-and-discovery.md](./features/search-and-discovery.md) | Header discovery, autocomplete, and public search results |
| [features/following.md](./features/following.md) | One-way creator following and Following feed |
| [features/comments-and-reactions.md](./features/comments-and-reactions.md) | Comments, replies, and likes |
| [features/notifications.md](./features/notifications.md) | Interaction notifications and realtime delivery |
| [features/messaging.md](./features/messaging.md) | Direct messaging, consent, block/restrict and the message workspace |
| [features/post-sharing.md](./features/post-sharing.md) | Sharing a post into a message, and share counting |
| [features/sharing.md](./features/sharing.md) | Share panel, recorded shares, and the share counter |
| [features/file-uploads-and-processing.md](./features/file-uploads-and-processing.md) | Direct/TUS uploads and processing |
| [features/admin-operations.md](./features/admin-operations.md) | Current admin capabilities |
| [features/online-status.md](./features/online-status.md) | Socket presence tracking |
| [features/demo-dataset.md](./features/demo-dataset.md) | Demo content dataset: stock media fetch, idempotent seed, exact cleanup |
| [domains/README.md](./domains/README.md) | Domain index |
| [domains/identity.md](./domains/identity.md) | Authentication, users, profiles, roles |
| [domains/content.md](./domains/content.md) | Posts, feeds, creator content management |
| [domains/community.md](./domains/community.md) | Comments, replies, reactions |
| [domains/system.md](./domains/system.md) | Settings and logging |
| [domains/file-service.md](./domains/file-service.md) | Upload, storage, processing, ownership |
| [user-roles.md](./user-roles.md) | Role capabilities and limits |
| [security.md](./security.md) | Implemented safeguards and gaps |
| [questions/README.md](./questions/README.md) | Product FAQ |
| [relationship/README.md](./relationship/README.md) | Relationship documentation index |
| [relationship/architecture-overview.md](./relationship/architecture-overview.md) | Cross-application dependencies |
| [relationship/api-endpoint-ui-component-mapping.md](./relationship/api-endpoint-ui-component-mapping.md) | Endpoint-to-consumer mapping |
| [relationship/feature-relationship-graph.md](./relationship/feature-relationship-graph.md) | Feature dependency graph |
| [relationship/feature-relationship-matrix.md](./relationship/feature-relationship-matrix.md) | Feature/app dependency matrix |
| [relationship/feature-relationship-summary.md](./relationship/feature-relationship-summary.md) | Change-impact summary |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Documentation maintenance |
| [_templates/feature-doc.md](./_templates/feature-doc.md) | Template for a new canonical feature doc |
| [_templates/faq-doc.md](./_templates/faq-doc.md) | Template for FAQ additions |
