---
name: notification-system
description: Interaction notifications for Douyin Clone, including grouping policies, realtime delivery, category filters, and inbox read state across api/ and user/.
---

# Notification System

Notifications are created by the backend after an interaction commits, never by the client.

## When to Apply

- Adding a new notification trigger (new event listener)
- Creating a new notification type or action constant
- Consuming notification state, count, or list in a React component
- Extending the notification schema or DTO
- Implementing toast/flash notifications in `user/` or `admin/`

---

## Frontend Toast Notifications (User + Admin)

`user` and `admin` share one toast implementation via:

```typescript
import { toast, toastHelpers, SharedToastProvider } from '@douyin-clone/shared-toast';
```

Source of truth: `shared/toast/`.

### Wiring (2026-08-17)

There is no root workspace, so each app installs the shared package from disk:

- `package.json`: `"@douyin-clone/shared-toast": "file:../shared/toast"`
- `next.config.js`: list `'@douyin-clone/shared-toast'` in `transpilePackages` — the package ships
  TypeScript source, not a build output.
- `react-toastify` must stay a dependency of the app itself. `shared/toast` has no `node_modules`, so
  it resolves `react-toastify` from the installing app. Two copies would give `SharedToastProvider`
  and the app's `toast()` calls separate instances and nothing would render.

Yarn 1 **copies** `file:` dependencies instead of linking them, and a plain `yarn install` will not
refresh an already-copied one. After editing anything under `shared/toast/`, run
`yarn install --force` in both `user/` and `admin/`, or they keep building against the stale copy.
A stale copy is easy to miss: the build still succeeds, it just uses the old code.
Do not add a `tsconfig.json` path alias for it — resolution goes through `node_modules`, and an alias
pointing at `../shared/toast` drags the out-of-app source into typechecking, where it cannot see React.

### Rules

- Do not import `toast` from `react-toastify` directly in app code.
- Do not use `antd` `message` or `notification` APIs in `admin`.
- Mount `SharedToastProvider` once in each app root `layout.tsx`.
- Do not mount `ToastContainer` in pages/components/hooks.
- Keep `react-toastify/dist/ReactToastify.css` imported at app layout level.

### Error handling rule

Use shared normalization instead of per-file extraction logic:

```typescript
toast.error(normalizeErrorMessage(error));
```

Avoid repeated `err.response?.data?.message` branches in components.

### Preferred helper usage

For repeated success copy, use `toastHelpers.*` (`saved`, `created`, `updated`, `deleted`, etc.) rather than duplicating hardcoded strings.

---

## Current Flow

- `api/src/common/constants/community.ts` — `NOTIFICATION_TYPES`, `NOTIFICATION_CHANNELS`, `NOTIFICATION_SOCKET_EVENTS`
- `api/src/schemas/community/notification/notification.schema.ts`
- `api/src/services/community/notification/notification.service.ts`
- `api/src/listeners/community/notification/` — reaction, comment, and delivery listeners
- `api/src/controllers/community/notification.controller.ts`
- `user/src/providers/notification.provider.tsx` — state, unread count, the single socket subscription
- `user/src/components/notification/notification-presentation.ts` — the only type switch on the client
- `user/src/components/notification/` — bell, panel, list, item

## Invariants

- Create notifications from a domain listener after the interaction is committed. Never from the frontend, and never from a click handler.
- Suppress self-notifications in `NotificationService`, not in the UI or individual listeners.
- Keep `{ recipientId, groupKey }` aligned with its unique index. Build policy-specific keys only through `NOTIFICATION_GROUP_KEYS`.
- Use `aggregate` for likes, `recordAdaptive` for comments/replies, `resurface` for follows, and `createOnce` for one-off events such as mentions.
- Use reaction/comment ids as aggregate event ids so queue retries never double-count or resurface an applied event.
- On unlike, use `replaceAggregateActor`; do not reorder or resurface the notification group.
- Order, paginate, and display by `lastActivityAt`, never `createdAt` — a resurfaced notification must reach the top of the list. Pass the field explicitly to `applyCursorPagination`.
- Default new resource reference fields to `null`, not absent, so unique-index null-equality stays deterministic.
- Store references and a type. Do not store rendered text, actor names, or thumbnails.
- Subscribe each listener under its own topic so its queue and worker stay isolated from the statistics listeners on the same channel.
- Keep notification creation and socket delivery in separate subscribers. Retrying delivery must never re-run creation.
- Let notification failures log and swallow. The interaction that triggered them must never roll back.
- Scope every read and write by `recipientId` inside the query itself. Never check ownership after fetching.
- Resolve actors, thumbnails, like counts, and follow state with batched lookups per page. Never per row.
- `NotificationDto` must expose `isAggregate`, `activityCount`, and computed `actorCount`, and define every setter called by `resolveMany`.
- Publish domain events only when the action actually occurred — for example `FollowService` publishes only when the upsert created the relation.
- A post carries several reaction actions (`like`, `share`), so filter reaction queries by `action`, not just `objectType`.
- Keep exactly one client subscriber to `notification:created`, mounted above the panel so the badge stays live while the panel is closed and open/close cycles cannot duplicate listeners.
- De-duplicate realtime inserts by `_id`, and re-count unread from the server rather than incrementing, because a de-duplicated repeat may resurface a read row.
- Add new type behavior to `notification-presentation.ts` only. Do not branch on notification type inside components. That includes the badge: the module resolves an icon *kind* and the component maps kinds to icons, so a new type gets a badge by adding one field, not a new `case`. Never write `case A || B:` in a type switch — it collapses to `case A` and silently drops B into the default branch.
- Badges belong to the six interaction types only. `follow` and unrecognised types resolve to `null`, and the row must then omit the disc entirely — the disc is the icon's backing, so rendering it without an icon leaves an empty circle over the avatar, which is the bug this rule exists for.
- Quoting the comment (`QUOTED_TYPES`) is narrower than being about a comment (`COMMENT_SCOPED_TYPES`). `comment_like` is comment-scoped — it deep-links and can show a deleted notice — but does not quote, because the text belongs to the reader.
- Keep `COMMENT_SCOPED_TYPES` the single answer to "is this row about a comment". It decides the deep link, the quoted preview and the deleted notice together, so a type left out of it navigates to the post while claiming to be about a comment. `comment_like` belongs there: its `commentId` is the liked comment and is stable for the life of the group.
- Deep-link comment-scoped rows through the existing `modal_id` + `modal_tab=comments` + `target_comment_id` params. There is no second navigation mechanism, and the ids must live in the URL so a refresh reopens the same comment.
- `COMMENT_REPLY` goes to the person being replied to — `replyToUserId` first, the top-level comment's author as fallback — never the post owner. Resolve the containing post separately, for navigation only.
- Never let a client-supplied id route a notification unchecked. `replyToUserId` may only be honoured after it is confirmed against stored data as a participant of that thread; otherwise fall back to the thread author.
- Opening the notification panel marks the whole inbox read through `PUT /notifications/read-all`. There is no single-row read endpoint or client method; row activation only navigates.
- `DELETE /notifications/:id` removes one row from the caller's own inbox. Put `recipientId` in the delete filter itself and answer `404` when nothing was deleted, so a guessed id neither removes nor confirms another user's row. Deleting is inbox-local: it must not touch the interaction, the actor, or another recipient's copy.
- After a client-side delete, remember the id briefly and drop `notification:updated` frames for it. An update already in flight would otherwise re-add a row the reader just removed. Restore nothing and release the unread count only when the request actually succeeded.
- Interactive controls inside a notification row (the `…` menu and its items) must stop propagation on click *and* keydown, or opening the menu also navigates the row.
- Start read-all and the first page in parallel, but synchronize a racing page response before committing it. Share one in-flight mutation across Strict Mode effect replays.
- Keep category filters server-backed so pagination remains correct: followers, mentions, comments, and likes. Reset cursor state, discard superseded responses, and reject realtime rows outside the active category.
- Mentions group `post_mention` and `comment_mention`. Both are produced, both use `createOnce`, and neither aggregates — being named is a direct interaction.
- Read mentioned ids off the stored post/comment. Never re-parse caption or comment text inside a notification listener, and always reduce client-supplied ids to existing accounts first.
- `NotificationPostMentionListener` handles `EVENT.CREATED` only. Notifying on `EVENT.UPDATED` would let an unrelated edit resurface mentions the recipient already read.
- Preserve the established CSS of `NotificationBell`, the panel shell, list, and rows. Only the filter menu owns new styling, following the compact Douyin reference.
- Build the panel filter with the shared `Dropdown` primitive. Keep open/close behavior and motion centralized there rather than recreating either inside `NotificationPanel`.
- Keep shared dropdown motion on `transform`, not the CSS `translate` property. Tailwind 4 uses `translate` for centered positioning, and overriding it shifts the header notification panel off-screen.
- Post targets go through the existing `modal_id` mechanism. `useHomeFeedPlayback` must release its restored-id latch when the parameter clears, or a post opened once cannot be opened again in the same session.
- Do not create the collection or its indexes in a migration. Mongoose runs with `autoCreate`/`autoIndex` defaults here, so the schema is the source of truth, matching every other collection.

## Share And Counters

- Shares are idempotent reactions with no un-share, so `totalShare` counts distinct sharers, not share actions, and the counter is only ever incremented.
- Move the client counter only when the record-share response reports `created: true`. Never re-derive idempotency on the client from a remembered flag; the backend result is authoritative.
- Record a share only when one actually completed. Opening the share panel, or pressing a control that does nothing, must not increment the counter or notify.
- Shares update statistics only and never create an interaction notification.
- Never claim a delivery the backend cannot make. Direct sending stays visibly disabled until messaging exists rather than silently succeeding.
- A post carries several reaction actions, so listeners and queries must filter on `action`, not just `objectType`.
- Counters shown while a post is open come from the post-interaction patch, not a second local counter. A post opened by `modal_id` may not be in the loaded feed, so patches must reach `detailPost` as well as the list.

## Adding A Type

Follow the runbook in `docs/features/notifications.md` ("Adding a new notification type"): constant, trigger, resource reference and migration, provider registration, batched resolution, client type, presentation entry, tests, docs.

## Verification

Run notification service/listener tests and `yarn build` in `api/`, then `yarn lint` and `yarn build` in `user/`. With two accounts, confirm post likes, comment likes, comments, replies, follows, read-all-on-open, category filtering during realtime delivery, unlike actor replacement, no share notification, and navigation without a read request.

## The replay-guard pattern has a second consumer

`MessageProvider` (`user/src/providers/message.provider.tsx`) reuses this provider's structure: mounted above its surfaces so the badge is live without the panel opening, a single socket subscriber so remounting cannot double-count, and a bounded seen-set so a replayed frame cannot resurrect state the user already cleared.

If you change the shape of that pattern here, check whether the message provider should change with it.

The header carries two independent indicators — the bell and the message icon — with identical markup and separate counters. Opening the notification panel must never affect message unread state.

See `.agents/skills/direct-messaging/SKILL.md`.
