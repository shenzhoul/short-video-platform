---
title: User Roles
description: Current access boundaries for guests, users/creators, and administrators.
audience: [user, creator, admin, developer-agent]
domain: identity
status: active
updated: 2026-08-05
tags: [roles, permissions]
---

# User Roles

## Guest

Guests can browse public feeds, post details, and active public profiles. They can read comments with anonymous context. They cannot create posts, edit profiles, comment, react, or use admin routes.

## User / creator

The code has one `user` role. A user acts as a creator when managing their public profile and posts.

Authenticated users can:

- view and update their own profile;
- upload avatar/cover media;
- create, list, edit, and delete their own posts when active and email-verified;
- comment, reply, edit/delete their own comments, and toggle likes;
- follow active creators once from the post action rail and browse their Following feed;
- receive online-status socket updates.

There is no separate creator-approval role, subscription entitlement, payout account, or monetization permission.

## Admin

Admins have the `admin` role and use the admin app to manage users/admin roles, adjust stored balance values, edit site/maintenance settings, and inspect operational logs. Admin APIs use role guards in addition to authentication.

Account statuses (`active`, `inactive`, `under-review`, `deleted`) affect visibility and access independently of role.
