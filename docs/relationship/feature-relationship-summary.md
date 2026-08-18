---
title: Feature Relationship Summary
description: Compact change-impact guide for the implemented feature set.
audience: [developer-agent]
domain: cross
status: active
updated: 2026-07-31
tags: [summary, impact, relationships]
---

# Feature Relationship Summary

## Highest-impact contracts

- User DTO and auth token changes affect API guards, both NextAuth configurations, profile providers, admin user screens, and socket authentication.
- Post DTO/media changes affect feeds, creator profiles, post detail, post management, comments/reaction targets, and file-reference cleanup.
- File-server response or auth changes affect API file services plus user/admin upload clients.
- Pagination changes affect backend `SearchRequest`/`PageableData` and the corresponding React Query hooks/components.
- Setting schema/key changes affect migrations, API cache/public responses, user layout, admin renderer, and settings navigation.
- Queue channel/event changes affect the publisher and every subscribed listener; scheduled queue names also persist in Redis across deployments.

## Lower-coupling areas

- Admin log viewers are largely isolated from content UI.
- Online presence is independent of comments/posts except for shared user identity.
- Recommendation ranking can change without changing the post response contract.

Use the [matrix](./feature-relationship-matrix.md) for app-level impact and the [API mapping](./api-endpoint-ui-component-mapping.md) for concrete consumers.
