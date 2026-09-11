---
title: Creator Profiles
description: Public username profiles and authenticated profile/media editing.
audience: [guest, user, creator, developer-agent]
domain: identity
status: active
updated: 2026-09-10
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

#### Paging both grids (2026-09-07)

Both tabs render the same grid and page through the same infinite-scroll
sentinel, driven by whichever tab is active. The page size is `POST_PAGE_LIMIT`
(20) for both, so 67 liked posts load as `20 + 20 + 20 + 7` as the reader
scrolls.

- `useLikedPosts` requests the first page the first time the tab is opened and
  never again. Leaving the tab and returning keeps the pages already loaded and
  keeps the cursor where it was — re-requesting page one would rewind
  `nextCursor` and `hasMore` to the first page's values and make the next three
  scrolls re-fetch content the list already held.
- The terminal message (`No more for now`) is shown only once the API reports
  `hasMore: false` for the **active** tab. Before 2026-09-07 it was printed
  unconditionally on `I like it`, under a grid that had only ever asked for its
  first page — so an account with 67 likes saw 20 posts and an end-of-list
  message underneath them.
- The count in the header account menu comes from the same endpoint's `total`,
  so the number in the menu and the set of posts the grid can reach come from one
  query with one set of filters. Since 2026-09-10 that is the menu's `limit=3`
  preview request rather than a separate `limit=1` count request.

#### Posts the viewer can no longer open (2026-09-10)

`GET /posts/liked` skips liked posts the viewer could not open in post detail —
a post its creator deleted (soft-deleted, awaiting cleanup) or one that was
deactivated. It uses the exact rule post detail applies
(`canViewerOpenPost` in `api/src/services/content/content.service.ts`): admins
and the post's owner see everything, anyone else needs an active post or one
whose creator account was deleted. Before this, such a post appeared as a tile
that answered "This post is no longer available." when opened.

Skipping would shorten a page, so the endpoint reads further reaction pages — at
most three extra — until it has `limit` openable posts. The cursor it returns is
always the last **reaction consumed**, so continuing never skips a like. Order is
unchanged: the reaction's `createdAt`, then its `_id`, newest first. `total` is
still the reaction count, so it can include a post the list no longer shows.

## Account menu previews (2026-09-10)

Signed-in users see small post previews inside the header account menu (hover
the avatar in the top-right corner).

| Row | Preview | Order | Source |
|---|---|---|---|
| `I like it` | up to 3 posts | most recently **liked** first | `GET /posts/liked?limit=3` |
| `My work` | up to 3 posts | most recently **published** first; a pinned post does not jump ahead | `GET /posts/creator-posts?userId=<me>&limit=3&creatorOrder=latest` |

How it behaves:

- Every time the menu opens it starts on `I like it`, with its preview open.
- Hovering `My work` (or focusing it with the keyboard) closes the liked preview
  and slides the works preview up from below. Hovering `I like it` again slides
  the liked preview down from above. Only one preview is ever open; the rows in
  between do not switch anything, and moving the pointer onto the tiles keeps
  the section open.
- A tile shows the post's cover (3:4 cover, then thumbnail, then first photo) and
  a one-line caption. Videos never play in the menu. A post with no usable image
  gets a neutral tile.
- Clicking a tile closes the menu and opens that post in the normal post detail
  modal, at `/?modal_id=<postId>` — the same address a notification uses.
- Clicking the row itself still goes to the matching profile tab. On a touch
  screen a tap on a row always navigates: taps never switch the preview, because
  switching would move the row out from under the finger before the tap's click
  arrives. Keyboard focus (Tab) switches it like hovering does.
- The counts next to the rows are the collections' real sizes, never the three
  previewed.
- Loading shows three placeholder tiles; an empty collection shows `No liked
  posts yet` / `No works yet`; a failed request shows `Try again` inside the
  section without affecting the rest of the menu.
- With reduced motion enabled, sections appear without sliding and tiles do not
  scale.
- Guests see the rows without previews, and nothing is requested for them.

Freshness: both previews are requested together when the menu opens, never while
moving between sections. The liked preview re-checks on every opening and drops a
post as soon as it is unliked anywhere in the app. The works preview is re-fetched
after the viewer creates, edits or deletes a post (the post service marks it
changed), and otherwise trusted for a minute. Previews are cached per account and
discarded when a different account signs in.

Implementation: `user/src/components/layout/navigation/user-account-dropdown.tsx`,
`account-menu-post-preview.tsx`, `user/src/hooks/use-account-menu-previews.ts`,
`user/src/lib/account-works-revision.ts`. Covered by
`user-account-dropdown-preview.spec.tsx`, the API specs for liked posts and creator
order, and `user/browser-verify/46-account-menu-previews.js`.
