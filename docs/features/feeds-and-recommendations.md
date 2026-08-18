---
title: Feeds and Recommendations
description: Public/home feeds, recommended videos, profile posts, and post detail.
audience: [guest, user, developer-agent]
domain: content
status: active
updated: 2026-08-05
tags: [feed, recommendation, pagination]
---

# Feeds and Recommendations

## Surfaces

- `/` uses the home feed.
- `/for-you` uses recommended video results.
- `/following` uses posts from creators followed by the authenticated user and includes a collapsible creator rail.
- `/[creator]` displays the selected creator's posts.
- Home and creator-profile cards open post details in-place with `?modal_id=<postId>`.

Creator profiles render video and graphic posts through their matching media experience. Graphic post cards use the ordered first image as the cover; opening one shows the complete ordered image set in a full-screen carousel with swipe and direct previous/next image controls. Multi-image details autoplay every four seconds. A full-width timeline drives each transition and preserves elapsed progress while paused. Clicking the image toggles playback; the center Play button appears only while paused, and the bottom control row contains only the Play/Pause icon.

Profile owners can enter **Batch management**, select individual loaded works or select all loaded works, and delete one or many posts. Each selected post still uses the owner-protected `DELETE /creator/posts/:id` lifecycle, including asynchronous media cleanup. Partial batch failures remove only successfully deleted works and keep failed selections available for retry.

On the home feed, graphic cards consume the complete ordered `files` image list. They display a **Text and images** badge at rest, hide it on hover, and reveal previous/next controls plus the current image position. Carousel controls change the card image without opening the post; clicking elsewhere opens the graphic detail popup. Video hover playback and its media layout remain unchanged.

Popup previous/next, vertical navigation controls, keyboard navigation, and wheel navigation use one ordered list of all supported feed posts. `post-detail-modal.tsx` is the single public detail modal for Home, For You, and creator profiles; it selects an explicit video stage or graphics carousel without routing images through video/PiP state. Both variants reuse `PostVideoActionRail` and `PostNavigationControls`. The graphics rail omits the AI entry and exposes **Related** where video exposes **Listen Video**. Its like state/count are synchronized with the active post, comments update the shared total, avatar/comment/related actions open the same detail panel contract, and Share uses the common modal link. Successful like/unlike and comment create/delete mutations patch the owning Home, For You, or profile post list immediately; the open modal and its originating card therefore keep the same `isLiked`, `totalLike`, and `totalComment` values without a reload. Crossing a boundary between video and graphics switches the internal renderer without dropping either media type, so a mixed feed remains fully navigable.

`use-post-interactions.ts` is the shared client interaction boundary. `usePostInteractionState` owns the active post button state and stable like/comment callbacks for both media variants; `usePostInteractionUpdater` merges successful changes into an owning post collection while preserving unchanged object and array identities. Components should consume these hooks instead of creating separate like/comment state and mutation callbacks.

Home card rendering is split by responsibility: `home-feed-card.tsx` owns card composition and playback chrome, `home-feed-cover-image.tsx` owns portrait/landscape cover treatment, and `home-feed-graphic-carousel.tsx` owns graphic-card carousel controls.

Home-feed media uses the original 16:9 card ratio for both compact and featured cards. Portrait covers keep the shared blurred-background treatment inside that frame. Compact metadata uses content-driven height and must not reserve a fixed blank block below short titles; vertical spacing comes from the grid row gap so video and graphic cards remain aligned.

## API

- `GET /posts/home-posts`
- `GET /posts/recommended`
- `GET /posts/following`
- `GET /posts/:id`
- `POST /posts/:id/view`
- authenticated owner listing through `GET /creator/posts` or `/creator/posts/search`

Feed queries filter active content and exclude deleted-author content. Public feed ordering is deterministic with `createdAt` and `_id` indexes. Recommended results use implemented engagement and recency signals.

Opening a post detail records one view for that post during the mounted popup session. Views made by the post owner are excluded. The API persists the non-negative `totalView`, returns the authoritative total, and profile-owner cards update immediately. The `1785772800000-add-post-total-view.js` migration backfills existing posts to zero before the field is relied on.

`user/src/hooks/use-home-feed-infinite-scroll.ts` owns home pagination, while `use-following-feed.ts` owns the authenticated following feed. Creator profile loading uses `use-creator-post-search.ts` and `use-creator-videos.ts`; there is no `/posts/infinite` or bookmark feed.
