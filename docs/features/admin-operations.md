---
title: Admin Operations
description: Current admin user management, settings, balance field, and operational log workflows.
audience: [admin, operator, developer-agent]
domain: cross
status: active
updated: 2026-07-31
tags: [admin, users, settings, logs]
---

# Admin Operations

The admin application currently provides:

- user list/search, create, update, detail, avatar, and delete operations;
- admin-role listing and toggle operations;
- stored user balance editing (without a wallet or transaction domain);
- general site identity and maintenance settings;
- audit, request, HTTP-exception, and system log viewers;
- current admin account settings.

Admin routes are protected by the admin session/proxy and backend role guards. See [pages and routes](../by-pages/README.md) for exact paths and [system domain](../domains/system.md) for setting keys.

There is no content moderation dashboard, payment administration, payout processing, dispute handling, banner manager, or analytics platform in the current admin app.
