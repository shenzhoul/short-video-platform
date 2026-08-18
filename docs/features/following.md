---
title: Creator Following
description: One-way creator follows, followed-creator discovery, and the Following feed.
audience: [user, creator, developer-agent]
domain: community
status: active
updated: 2026-08-13
tags: [following, feed, creator, reaction]
---

# Creator Following

Authenticated users can follow another active creator from the avatar action rail. The red `+` is shown only when the viewer is not the creator and has not followed them. Following is intentionally one-way from this surface: the request is idempotent, the `+` disappears after success, and pressing the same action again cannot unfollow.

Follow relationships reuse the `reactions` collection with `objectType=creator` and the dedicated `action=follow`. The compound unique index prevents duplicates, while `stats.followers` and `stats.followings` are incremented only when the upsert creates a new relationship.

There are no separate `followers` and `followings` schemas: those are the two directions of the same relationship (`createdBy` is the follower and `objectId` is the followed creator). The `Reaction` schema owns `createdAt` and `updatedAt` through Mongoose timestamps, so follow upserts must not set either timestamp manually. Migration `1785891600000-migrate-creator-follows.js` converts legacy creator `like` relations to `follow` without duplicating an already-migrated relation, then rebuilds both cached counters from the authoritative relationships. Orphan counters with no relationship rows are reset instead of being displayed as users that cannot be identified.

## Following page

`/following` is authenticated and displays active posts from followed creators in newest-first order. Its creator rail supports:

- a compact avatar list;
- an expanded searchable list;
- a shared hover dropdown for recently-followed and earliest-followed ordering;
- a Douyin-style creator row whose trailing more affordance appears only on hover or keyboard focus;
- a creator action modal that copies the Douyin ID or cancels the relationship and removes that creator's posts from the current feed immediately;
- selecting a creator avatar to jump to that creator's first loaded video and open the full-screen shared post detail popup with the `Videos` tab active.

Both video and graphic posts remain in the feed. They reuse the existing post action rail, detail modal, media renderers, reaction state, comments, sharing, and vertical post navigation.
Following videos also reuse the Home popup-PiP media identity. While the active video is playing in PiP, its original stage displays **Currently playing**; closing PiP restores that player without relying on its page-specific instance ID.
Graphic posts use the same four-second carousel timing as the shared detail popup, including play/pause, previous/next controls, a full-width segmented timeline, and a centered play affordance while paused.
The post action-rail avatar uses the same behavior as `/for-you`: it opens the current post in the full-screen shared detail popup, preserves playback time for videos, and activates the `Videos` tab for both videos and graphics. The creator rail opens the creator's first loaded video; if none is loaded, it falls back to the first loaded graphic post.
The `Videos` tab is a creator-works playlist despite its product label: it always queries and displays every supported post type from that creator. The currently opened post is merged into that result without filtering the remaining graphic or video posts, so switching media types cannot change the playlist contents.
Both media variants reserve the same 68px outer gutter for vertical post navigation, so the up/down controls never overlap the graphic or video action rail.
The compact and expanded creator rail uses shared surface, border, and text tokens. It therefore matches the white Douyin navigation surface in light mode while retaining the existing dark surface in dark mode. The expanded rail is 208px wide; the compact rail remains 72px wide so the media stage begins at a stable edge in both states. Search and sort operate on the same rendered creator list, and the sort panel reuses the shared dropdown with hover activation.
Graphic previous/next controls stay inside the media stage, but the next control reserves a 112px action-rail safe lane. Carousel navigation can never sit under the avatar, reaction, comment, collection, or share controls.

## API

- `DELETE /users/:id/follow` — idempotently stop following a creator and decrement non-zero relationship counters once.

- `POST /users/:id/follow` — idempotently follow an active creator; self-follow is rejected.
- `GET /users/following` — list followed creators for the authenticated user.
- `GET /users/:id/followings` — list creators followed by one profile.
- `GET /users/:id/followers` — list users following one profile.
- `GET /posts/following` — cursor/offset-paginated active posts authored by followed creators.

The reaction schema keeps the ordered following lookup index on `createdBy`, `objectType`, `action`, `createdAt`, and `_id`.
