---
title: Creator Profiles
description: Public username profiles and authenticated profile/media editing.
audience: [guest, user, creator, developer-agent]
domain: identity
status: active
updated: 2026-08-04
tags: [creator, profile, avatar, cover]
---

# Creator Profiles

Every regular account has the backend `user` role. “Creator” identifies a user presenting a public profile and publishing posts; it is not a separate authorization role.

## Public flow

- `GET /users/:username` resolves an active profile.
- `user/src/app/(public)/(main)/[creator]/page.tsx` renders the profile and its posts.
- Video works keep their hover-preview and video-detail behavior. Graphic works use the first ordered post image as the profile cover, identify multi-image posts, and open a full-screen image detail carousel with the creator, caption, engagement actions, and adjacent graphic-post navigation.
- Deleted accounts return gone/not-found behavior; inactive or unavailable accounts are restricted.

## Authenticated management

- `GET /users/me` loads the current profile.
- `PUT /users/manager` updates profile fields and can update the password credential.
- `PUT /users/me/avatar` and `PUT /users/cover` attach previously uploaded owned files.
- Avatar/cover uploads begin through `api/src/controllers/identity/identity-file.controller.ts`.

Profile media mutations validate file ownership before adding persistent references.

### Works and liked posts

- The profile `Works` tab lists posts published by the profile owner. Owners can enter batch management, select one or more posts, and delete them.
- The owner-only `I like it` tab loads the current user's liked posts from `GET /posts/liked` in newest-like-first order. It supports both video and graphic posts and uses the same post detail modal and interaction state as other feeds.
- Batch management on `I like it` changes the action to `Unlike`. `DELETE /posts/liked` accepts up to 50 unique `postIds` and idempotently removes only the current user's like reactions, so retries cannot accidentally like a post again.
- Unliking from either the batch toolbar or the post detail action rail immediately removes the post from the liked collection and updates the displayed total.
