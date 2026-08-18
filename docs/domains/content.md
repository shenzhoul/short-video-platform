---
title: Content Domain
description: Post creation, ownership, feeds, recommendations, and post media.
audience: [user, creator, developer-agent]
domain: content
status: active
updated: 2026-08-05
tags: [post, feed, recommendation, media]
---

# Content Domain

## Post types

The accepted create/update types are `text`, `photo`, and `video`. A post can contain a title, sanitized text, tagline, owned file IDs, optional thumbnail/teaser IDs, and a status.

Audio and scheduled-stream values appear only in legacy comments; they are not accepted by `PostCreatePayload`.

## Creator management

Authenticated active users with verified email can create and delete their own posts through `/creator/posts`. File ownership is validated before a post mutation and file references are updated asynchronously.

User routes:

- `/creator/publish` for choosing a publishing type;
- `/creator/publish/video` for video publishing;
- `/creator/publish/image` for graphics publishing.

## Public consumption

- `GET /posts/home-posts` returns a pageable active-post feed.
- `GET /posts/recommended` returns cursor-paginated video recommendations ranked from implemented engagement/recency signals.
- `GET /posts/:id` returns post detail.
- `/`, `/for-you`, and `/[creator]` are the main public pages. Post details open in a shared popup addressed by the `modal_id` query parameter instead of a standalone post-detail route.

The home and recommendation feeds remain discovery-oriented. `/following` is the dedicated authenticated feed filtered to creators the user follows.

## Consistency

Deleting a post first marks it `deleted`, immediately excluding it from active creator and public queries, and then publishes a versioned queue snapshot. The retryable cleanup worker hard-deletes:

- the post and its post-media rows;
- top-level comments, replies, and reactions on those comments;
- direct post reactions, including likes and favourites;
- main media, thumbnail, and teaser files.

After cleanup, creator-like and affected hashtag summaries are rebuilt from the posts that still exist. These are exact reconciliations rather than counter decrements, so duplicate queue delivery and partial retries do not double-subtract data. Bulk cleanup does not publish ordinary comment/reaction counter events because their parent post no longer exists.

Post create and update use the same exact hashtag reconciliation. New databases create the `idx_tags` index from `PostSchema`; no post-tag backfill is required when the database starts empty.

User deletion publishes a separate queue event so deleted-author flags can be updated outside the request path.

### Automated verification

The API uses Jest with ts-jest for isolated service tests. Deletion coverage includes ownership and tombstoning, versioned queue snapshots, retry-safe dependent cleanup, comment/reply reaction cleanup, file-server failures, and exact hashtag reconciliation.

From `api/`, run:

```bash
yarn test
yarn build
```
