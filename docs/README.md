---
title: Douyin Clone Documentation
description: Canonical documentation for the features and architecture implemented in this repository.
audience: [user, creator, admin, operator, developer-agent]
domain: cross
status: active
updated: 2026-09-06
tags: [overview, index, documentation]
---

# Douyin Clone Documentation

This documentation describes the code that currently exists in `api/`, `user/`, `admin/`, and
`file-server/`, and the production deployment in `deploy/`.

The platform is **deployed and serving**: all four applications run as Docker containers on a single
VM behind nginx with TLS, with MongoDB and Redis as private services and media in Cloudflare R2
served through a Worker. See [deployment/README.md](./deployment/README.md).

## Start here

- [Architecture](./architecture.md): applications, infrastructure, and data flow.
- [Platform highlights](./highlights.md): verified product and technical capabilities.
- [Pages and routes](./by-pages/README.md): current user and admin pages.
- [Features](./features/README.md): implemented user-visible and operational workflows.
- [Domains](./domains/README.md): identity, content, community, system, and file service.
- [Relationships](./relationship/README.md): cross-app graph, matrix, and API-to-UI mapping.
- [User roles](./user-roles.md): guest, user/creator, and admin boundaries.
- [Security](./security.md): safeguards present in code and known limitations.
- [FAQ](./questions/README.md): concise product guidance.
- [Documentation index](./index.md): every maintained document.

## Implemented scope

The current product supports:

- credentials-based authentication, email verification, password reset, and logout;
- public creator profiles and authenticated profile editing;
- text, photo, and video posts;
- a ranked Home discovery feed and a personalized For You feed, both paged through Redis-stored
  recommendation sessions linked into per-page-load browsing chains;
- recommendation event ingestion (impressions, watch quality, dwell, skips, interactions) feeding a
  decayed per-subject affinity profile;
- post detail with its own anchor-based recommendation sequence, and a picture-in-picture player
  that navigates the same sequence;
- comments, replies, like reactions, mentions, and one-way creator following;
- private one-to-one messaging with follow-based send permission, request consent, and block/restrict;
- interaction notifications with grouping, category filters, and realtime delivery;
- search across posts, creators, and hashtags;
- direct and resumable file uploads with image/video processing;
- system identity and maintenance settings;
- admin user management, role assignment, balance editing, settings, and log viewers;
- Socket.IO connection tracking and online-status events.

The repository does **not** currently implement payments, paid subscriptions, payouts, wallet transactions, live streaming, direct messaging, notifications, mutual friends, reporting/blocking, products/store, banners, coupons, or third-party cloud storage adapters. Do not document those as shipped features until matching code exists.

## Source of truth

Code, package manifests, migrations, and routes are authoritative. Update the nearest domain or page document in the same change whenever behavior changes. Use [CONTRIBUTING.md](./CONTRIBUTING.md) for documentation rules.
