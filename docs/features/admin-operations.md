---
title: Admin Operations
description: Current admin user management, settings, balance field, and operational log workflows.
audience: [admin, operator, developer-agent]
domain: cross
status: active
updated: 2026-09-06
tags: [admin, users, settings, logs, categories]
---

# Admin Operations

The admin application currently provides:

- user list/search, create, update, detail, avatar, and delete operations;
  A user with no uploaded avatar is shown the shared `no_avatar.jpeg`
  placeholder in the list, the user selector and the avatar tile on
  detail/edit — a display fallback only, never written to the record. The
  upload affordance stays visible over the placeholder, so a tile that has not
  been set still reads as clickable. See
  [creator profiles → the default avatar](./creator-profiles.md#the-default-avatar-2026-09-06);
- post category management (**Content → Categories**);
- admin-role listing and toggle operations;
- stored user balance editing (without a wallet or transaction domain);
- general site identity and maintenance settings;
- audit, request, HTTP-exception, and system log viewers;
- current admin account settings.

Admin routes are protected by the admin session/proxy and backend role guards. See [pages and routes](../by-pages/README.md) for exact paths and [system domain](../domains/system.md) for setting keys.

## Post categories (2026-08-25)

The content categories creators file posts under are stored in the `categories` collection and
managed at **Content → Categories** (`/content/categories`). They used to be a hard-coded list in the
API source; adding, renaming, reordering, or retiring one is now an admin action with no deploy.

Each category has:

- **Key** — the permanent identifier every post filed under the category stores. It is entered when
  the category is created (pre-filled from the name) and is **read-only afterwards**. Keys are
  lowercase letters, digits, and single hyphens, and must be unique; a duplicate is rejected with a
  clear conflict message rather than silently given a suffix.
- **Name** — the label creators and visitors see. Safe to change at any time; posts are unaffected.
- **Description** — an internal note, not shown outside the admin app.
- **Status** — `Active` or `Disabled`.
- **Display order** — ascending; lower numbers appear first. The thirteen seeded categories are
  spaced ten apart so a new one can be slotted between two of them without renumbering.

**Categories are never deleted.** The list's destructive action disables a category: it disappears
from the creator topic picker and the home category bar, and can no longer be chosen for new posts,
while every post already filed under it keeps working. Re-enable one by editing it and setting the
status back to `Active`. A physical delete is deliberately not offered — posts store the key, and
without transactions a "check for references, then delete" step would race a post being created at
that moment.

A fresh installation gets the thirteen default categories from the API migrations (`cd api && yarn
migrate`, step 5 of the README setup). Re-running migrations never duplicates them and never
overwrites an admin's edits.

There is no content moderation dashboard, payment administration, payout processing, dispute handling, banner manager, or analytics platform in the current admin app.
