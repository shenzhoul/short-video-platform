---
title: Community Domain
description: Implemented comments, replies, likes, and creator following.
audience: [user, creator, developer-agent]
domain: community
status: active
updated: 2026-08-13
tags: [comment, reply, reaction, like, notification, share]
---

# Community Domain

## Comments

Comments currently target posts; replies use comment relationships and optional reply-user metadata. Reading comments supports pagination and optional user context. Creating, editing, and deleting requires authentication, with throttling on mutations.

API routes:

- `POST /social/:contentType/:contentId/comments`
- `GET /social/:contentType/:contentId/comments`
- `PUT /social/comments/:commentId`
- `DELETE /social/comments/:commentId`

## Reactions

The reaction actions defined in code are `like`, `follow`, and `share`. All three share the `reactions` collection and are distinguished by `objectType` and `action`.

- `POST /social/:contentType/:contentId/reactions/toggle` — toggles `like`
- `POST /social/:contentType/:contentId/share` — records a `share` on a post and increments `Post.totalShare` (see [Post Sharing](../features/sharing.md))

Because a post can carry more than one action from the same user, any consumer deriving a single flag such as "is liked" must filter by `action` rather than assume one reaction per object.

Queue listeners update aggregate like/comment counts, create notifications, and clean related data after deletion.

## Notifications

Authenticated users receive grouped notifications for post/comment likes, comments, replies, and follows. Shares affect statistics only. Notifications use policy-specific `groupKey` identities and are delivered over the socket to the recipient only. Mention types and the Mentions filter are reserved for the upcoming mention producer.

API routes:

- `GET /notifications`
- `GET /notifications/unread-count`
- `PUT /notifications/read-all`

See [Interaction Notifications](../features/notifications.md).

## Creator following

Authenticated users can idempotently follow active creators. Creator follow state is populated into post/profile user DTOs and drives the one-way avatar `+` action, the followed-creator list, and `/following` feed. See [Creator Following](../features/following.md).

Follow state also governs messaging permission. `FollowService.areMutuallyFollowing` and `getMutualFollowerIdSet` are read live on every send and on every conversation list — the follow relation is never copied onto a conversation, so an unfollow takes effect on the next message.

## Direct messages

Authenticated users exchange private one-to-one messages. Mutual followers message freely; everyone else goes through a message request — the initiator sends one message and waits, and the recipient's reply accepts it, after which both may message freely. Permission is evaluated per send from the live follow relation and enforced by atomic conditional updates on `Conversation.pendingSenderId` and `requestAccepted`. An unfollow resets an accepted request.

Collections: `conversations` (pair identity via a unique `hashKey`, plus the preview and the request state), `conversation_participants` (per-user unread and read state), `messages` (`text`, `image`, `video`).

API routes:

- `GET /conversations`, `POST /conversations`, `GET /conversations/:id`, `PUT /conversations/:id/read`
- `GET /messages/conversations/:conversationId`, `POST /messages/conversations/:conversationId`
- `GET /messages/unread-count`, `PUT /messages/read-all`

See [Direct Messaging](../features/messaging.md).

## Not implemented

Live chat, group conversations, mutual friends, bookmarks, user blocking, content reports, and live-stream interaction are not part of the current community domain. Notification settings, muting, message deletion, and message moderation are also not implemented.
