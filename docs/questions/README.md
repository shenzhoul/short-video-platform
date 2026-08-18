---
title: Product FAQ
description: Concise answers about the capabilities currently available.
audience: [guest, user, creator, admin]
domain: cross
status: active
updated: 2026-08-05
tags: [faq, help]
---

# Product FAQ

## What can I do without signing in?

Browse the home and For You feeds, open public post details, view active creator profiles, and read comments.

## How do I publish?

Sign in with an active, email-verified account and open `/creator/publish`. Choose Upload videos or Upload graphics, prepare the media, and submit. Published posts appear on Home and your creator profile.

## Which interactions are available?

Authenticated users can comment, reply, edit/delete their own comments, and toggle a like reaction.

## Which account types exist?

The backend has `user` and `admin` roles. “Creator” means a user publishing posts; it is not a separate role.

## Are payments, subscriptions, live streams, or messages available?

Creator following is available through the post avatar action and `/following`. Payments, wallets, paid subscriptions, payouts, live streams, direct messages, notifications, mutual friends, report/block, and store features are not implemented.

## Where do admins work?

The admin app provides user/admin management, general site and maintenance settings, and audit/request/error/system log viewers.

## Where are files stored?

The implemented storage backend is local disk. Uploads can be direct or resumable with TUS, and image/video media is processed by Sharp/FFmpeg.

## Why does a visible menu link return 404?

A few UI links currently have no matching Next.js page. They are tracked as defects and are not supported features.
