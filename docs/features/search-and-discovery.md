---
title: Search and Discovery
description: Header search discovery, autocomplete, and public search results.
audience: [guest, user, developer-agent]
domain: content
status: active
updated: 2026-08-11
tags: [search, discovery, autocomplete, trending]
---

# Search and Discovery

## Header search

The desktop header search opens a discovery panel on hover or keyboard focus. A hover-safe bridge covers the visual gap between the input and panel so the panel remains open while the pointer moves between them. After a viewer clicks or tabs into the input, the panel also stays open when the pointer leaves the search area. It closes when focus leaves the search control; pressing Escape removes input focus and closes it when the pointer is outside.

With an empty input, the panel shows:

- recent local search history, with per-item removal and a clear-all action
- six personalized suggested searches, with the first two positions visually emphasized and a control that rotates the displayed order
- ranked hot topics, where the trend marker is separate from numbered ranks 1 through 5

Hovering a history chip brightens its text and reveals its remove control centered on the chip's upper-right corner. Suggested-search entries use a pointer cursor, keep their existing color on hover, and only increase brightness. Hot-topic rows receive a subtle full-width surface background within the panel's horizontal padding.

Typing replaces discovery content with plain-query, creator, and hashtag suggestions returned by the autocomplete API; the raw input is not inserted as an extra first result. Every case-insensitive occurrence of the current input within an autocomplete label uses the Douyin red accent, while unmatched label text remains the normal foreground color. Selecting any discovery or autocomplete item navigates to `/search?q=<query>`.

Search history remains local to the browser. Up to the first three recent terms are sent to `GET /search/discovery` to bias suggestions; the API does not persist a viewer search log.

## Main surfaces

- Header search on public user pages
- `/search?q=<query>` for combined post, creator, and hashtag results

## API

- `GET /search/discovery`
- `GET /search/suggestions`
- `GET /search`
- `GET /search/topics`
- `GET /search/related`
