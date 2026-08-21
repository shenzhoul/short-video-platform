---
name: websocket-integration
description: Socket.IO integration for Douyin Clone online presence and real-time events. Use when changing gateways, SocketUserService, Redis adapter behavior, user connection tracking, or frontend socket listeners.
---

# WebSocket Integration

Trace gateway authentication, socket-user state, event emission, client subscription, and disconnect cleanup together.

## Current References

- `api/src/gateways/socket/user-connected.gateway.ts`
- `api/src/services/socket/socket-user.service.ts`
- `api/src/jobs/socket/socket-cleanup.job.ts`
- `user/src/socket/`
- `user/src/socket/socket-context.tsx`

## Rules

- Authenticate or load identity before joining user-scoped rooms.
- Treat Redis/MongoDB as shared state; do not rely on one process's socket map.
- Keep gateway handlers thin and delegate business rules to services.
- Use stable event names and typed payloads.
- Register client listeners once and always remove them during cleanup.
- Handle reconnects and duplicate events idempotently.
- Preserve online-status cleanup through the scheduled job.

## Verification

- Check anonymous connection, authenticated connection, reconnect, multiple tabs, disconnect, stale cleanup, and multi-instance delivery.
- Run API build and relevant user tests/lint/build.

## Direct message events

Emitted by `MessageDeliveryListener` on the existing connection — no new namespace, no conversation rooms, no second client connection.

| Event | Sent to | Payload |
|---|---|---|
| `message:created` | Both participants | The message |
| `conversation:updated` | Each participant separately | That reader's own row |
| `message:unread-updated` | The affected reader | Absolute unread totals |
| `message:read` | The reader's own sessions | `{ conversationIds }`, `null` meaning all |

Two rules to preserve: delivery is a **separate** queue subscriber from creation, so a retried emit never re-runs creation; and clients de-duplicate on the server `_id`, since the sender receives their own message back to keep their other tabs in sync.

See `.agents/skills/direct-messaging/SKILL.md`.

## Live Post Detail rooms

Room-scoped events for an open post. The design constraint is a viral post: a
comment can take thousands of likes a second, and none of it may become a
per-mutation broadcast.

| Room | Joined when | Carries |
|---|---|---|
| `post:{postId}` | Post Detail is open | comment content events, coalesced counter snapshots |
| `comment:{commentId}:replies` | that thread is **expanded** | reply bodies, and nothing else |

| Event | Room | Payload |
|---|---|---|
| `post:comment_created` | post | the new top-level comment |
| `post:reply_created` | post | `{ eventId, postId, parentCommentId, createdAt }` — **no body** |
| `post:comment_deleted` | post | `{ commentId, rootId? }` |
| `post:stats_updated` | post | absolute `totalLike/totalComment/totalShare` + `version` |
| `post:comment_stats_updated` | post | `{ commentId, parentCommentId, likesCount, replyCount, revision }` |
| `comment:reply_created` | thread | the full reply |

### Rules that keep it bounded

- **Content is emitted per event; counters never are.** A counter mutation calls
  `markDirty` on a coalescer, and a BullMQ-scheduled flush (`PostStatsFlushJob`,
  500ms) emits at most one snapshot per subject per interval. Broadcast volume is
  bounded by the flush rate, not by traffic.
- **Snapshots are absolute totals, never deltas.** That is what makes a dropped
  frame, a reconnect, and an HTTP response racing its own socket echo all
  self-correct — applying the same snapshot twice reaches the same number.
- **Every snapshot carries a `revision`** (the subject's `updatedAt`). Clients
  discard anything not strictly newer, so a frame that overtook another cannot
  roll a count backwards.
- **`markDirty` must run *after* the counter write commits**, in the same
  listener that performs it. Marking from a second subscriber on the same channel
  has no ordering guarantee: the mark can land first, a flush in that gap
  publishes the pre-increment total as final, and nothing comes along to correct
  it. See `comment-reaction.listener.ts` and `comment-reply.listener.ts`.
- **Reply bodies go to the thread room only.** The post room is mostly viewers
  with that thread collapsed; sending bodies there would put the bulk of a busy
  post's traffic in front of people not reading it.
- **`SPOP` drains the dirty set**, so overlapping flushes on several instances
  split the work rather than duplicating it.
- Admission is decided server-side (`PostRoomService.canView`), and the thread
  rooms reuse that same call — a thread must never become a way around a post
  nobody may see.

### Client side

- `usePostRoom(postId)` / `useCommentRoom(commentId)` tie membership to the
  effect, so switching posts leaves the previous room and a reconnect re-joins.
- Counters live in `CommentLiveStatsStore` (`useSyncExternalStore`), **not** in
  the comment list state: a like on one comment must re-render one row, not the
  tree. Writes are published once per animation frame, so a burst costs one
  render carrying the final value.
- A live total must not reset the viewer's own `isLiked`. `LikeButton` keeps the
  two in separate effects for exactly this reason — see its comment.
