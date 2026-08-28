---
title: Online Status
description: Socket authentication, connection tracking, stale-presence cleanup, and online events.
audience: [user, developer-agent]
domain: community
status: active
updated: 2026-08-28
tags: [socket, presence, online]
---

# Online Status

The user app connects with Socket.IO, emits `auth/login` with its token, and listens for `online` events through `use-user-online-status.ts`.

The API:

- handles socket connect/disconnect/auth events in `user-connected.gateway.ts`;
- tracks user socket IDs through `SocketUserService`;
- publishes connection changes through `QueueMessageService`;
- runs a BullMQ scheduler to clean stale socket presence;
- emits online-status updates to the global room.

This document covers presence tracking only. Direct messaging and in-platform interaction notifications are implemented as separate socket-backed domains; chat rooms, live-stream rooms, push notifications, and notification preferences are not implemented.

See [Direct Messaging](./messaging.md) and [Interaction Notifications](./notifications.md).
