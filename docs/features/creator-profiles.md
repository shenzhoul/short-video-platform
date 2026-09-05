---
title: Creator Profiles
description: Public username profiles and authenticated profile/media editing.
audience: [guest, user, creator, developer-agent]
domain: identity
status: active
updated: 2026-09-06
tags: [creator, profile, avatar, cover]
---

# Creator Profiles

Every regular account has the backend `user` role. “Creator” identifies a user presenting a public profile and publishing posts; it is not a separate authorization role.

## Public flow

- `GET /users/:username` resolves an active profile.
- `user/src/app/(public)/(main)/[creator]/page.tsx` renders the profile and its posts.
- Video works keep their hover-preview and video-detail behavior. Graphic works use the first ordered post image as the profile cover, identify multi-image posts, and open a full-screen image detail carousel with the creator, caption, engagement actions, and adjacent graphic-post navigation.
- Deleted accounts return gone/not-found behavior; inactive or unavailable accounts are restricted.

## The default avatar (2026-09-06)

An account that has never uploaded a picture is shown a shared placeholder,
`no_avatar.jpeg`, everywhere a user appears: the header account menu, profiles,
comments, messages, notifications, search results, follower and following lists,
the share and mention pickers, the publish-preview phone mockup — and, in the
admin app, the user list, the user selector and the avatar tile on user
detail/edit.

**It is a presentation fallback and nothing more.** No `no_avatar.jpeg` path is
ever written to Mongo, no file-server record is created for it, and no R2 object
exists behind it. A user with no avatar keeps the field absent in the database,
which is what keeps "has never set one" distinguishable from "chose this
picture" and what stops the unused-file sweeper and the profile-image reference
logic from ever seeing a phantom file. Uploaded avatars are untouched.

A value that is present but blank — an empty string, or only whitespace — counts
as absent. A whitespace `src` is not a URL: the browser resolves it against the
page and silently re-requests the current document.

Two implementation notes for anyone changing this:

- The single helper is `user/src/lib/avatar.ts` (`resolveAvatarUrl`,
  `hasCustomAvatar`, `DEFAULT_AVATAR_URL`). Do not write
  `avatar || '/no_avatar.jpeg'` inline again — that is the arrangement this
  replaced, and it was inconsistent: 23 files did it, the account dropdown drew a
  grey glyph instead, and two places (`share-recipient-row`, the admin user list)
  pointed at `/no-avatar.png`, a file that does not exist in either app.
- `admin/` is a separate Next application on its own origin, so a root-relative
  `/no_avatar.jpeg` has to exist in `admin/public/` as well. The bytes are
  duplicated deliberately — Next serves `public/` from disk at the app root, and
  a shared package would still need a build step to copy them in. The duplication
  is pinned by `user/src/lib/avatar.spec.ts`, which compares the two files byte
  for byte and fails if either changes without the other. It lives in the user
  app's suite because `admin` has a `test` script but no Jest configuration.

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
