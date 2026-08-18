---
title: Identity Domain
description: Authentication, user accounts, public profiles, and admin role management.
audience: [user, creator, admin, developer-agent]
domain: identity
status: active
updated: 2026-07-31
tags: [auth, user, profile, admin]
---

# Identity Domain

## Current model

The backend has two authorization roles: `user` and `admin`. “Creator” is a product/UI term for a user who owns a public profile and posts; it is not a separate role constant.

User lifecycle statuses are `active`, `inactive`, `under-review`, and `deleted`. Public profile lookup rejects deleted accounts and restricts unavailable accounts.

## Authentication

- User and admin apps use NextAuth credentials providers.
- The API authenticates email/password through `POST /auth/login`.
- Session callbacks retain API access/refresh tokens.
- Logout endpoints exist for authenticated, security, and public cleanup paths.
- No registration, password-reset API, email-verification workflow, 2FA, or configured OAuth provider is currently shipped.

## Profiles

Authenticated users can read their own profile, update profile fields/password, upload an avatar, and upload a creator cover. Public profiles resolve by username. Content creation requires an active account with a verified email; admins bypass that check.

## Admin operations

Admins can search/create/update/delete users, update avatars, view user details, adjust balance fields, list admins, and toggle the admin role.

## Main API routes

- `POST /auth/login`
- `POST /auth/logout`, `/auth/logout/security`, `/auth/logout/public`
- `GET /users/me`
- `GET /users/:username`
- `PUT /users/manager`, `/users/cover`, `/users/me/avatar`
- `/admin/users...`
- `/admin/permissions...`
- `PUT /admin/auth/user/password`
