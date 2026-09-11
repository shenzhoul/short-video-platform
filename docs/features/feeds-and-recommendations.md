---
title: Feeds and Recommendations
description: Public/home feeds, recommended videos, profile posts, and post detail.
audience: [guest, user, developer-agent]
domain: content
status: active
updated: 2026-09-06
tags: [feed, recommendation, pagination, recommendation-engine, picture-in-picture]
---

# Feeds and Recommendations

## Surfaces

- `/` uses the home feed.
- `/for-you` uses recommended results. The recommender returns photo posts as well as videos, and
  the stage draws each by what it actually holds: a video post gets the player, a photo post gets the
  full-bleed image carousel. A `<video>` element is never mounted for a post with no video — that was
  a real defect (a black rectangle with transport controls where a photo post should have been, plus
  a React "empty string was passed to the src attribute" error), and it was the *first* thing a
  visitor saw, because the ranked feed opened on a photo post. A recommended post the stage cannot
  draw at all is skipped with a logged reason rather than rendered as a blank slide.
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

## Recommendation engine (Home and For You, since 2026-09-02)

Home and For You are both ranked by a from-scratch **heuristic** recommendation engine — not a
reproduction of any platform's proprietary system. `Following` is unaffected: it stays a plain
`createdAt`-ordered feed of posts from followed creators, and pinning stays a creator-profile-only
concept that never influences Home/For You ranking. See
`.agents/skills/recommendation-engine/SKILL.md` for the full implementation contract; this section is
the product-level summary.

**How a session works.** The first time a person opens Home or For You (or reloads, or switches a
Home category tab, or the previous session expires), the server retrieves a bounded candidate pool
from five sources — personalized (category/hashtag/creator affinity), trending (engagement quality
with time decay), fresh (recently posted, or never-yet-scored), social (followed creators), and
diverse (categories/creators the person has little exposure to) — scores every candidate, re-ranks it
for creator/category variety, and stores the whole ranked order in Redis under a new session id.
"Load more" pages through that same stored order (never recomputed, never duplicated); reloading the
page always starts a brand-new session with a new mix.

**A session is a subset, not the catalogue (since 2026-09-03).** The candidate pool and the session
used to be the same size, and on a small catalogue that meant a session contained essentially
everything: reloading could only reshuffle one fixed set, and — because scoring is deterministic
apart from a tie-breaking jitter — the same post led every reload. Measured across ten guest reloads
before the change: one distinct lead post, 6-9 of the top 10 shared between consecutive sessions,
and no post ever leaving the session.

Retrieval is still wide (recall is cheap and useful), but what a session *shows* is now a bounded,
seeded, score-weighted sample of that pool — roughly 70 posts for Home, 40 for For You, configured
in `SESSION_OUTPUT_POLICY`. A candidate scoring twice as high as another is drawn several times as
often, so ranking still decides what you are likely to see; it simply no longer decides it
identically every time. Nothing is shuffled at random, and pagination inside one session stays
exactly as stable as before, because the sampling is driven by the session seed rather than by
`Math.random()`.

The lead post is chosen separately: a seeded weighted draw from the top-scoring window, skipping
posts that recently led this person's feed. That memory is a short-lived cooldown per person and
surface, not a ban — a post pushed out of the lead slot today can lead again once it expires. After
the change, the same ten-reload measurement gives **10 distinct lead posts out of 10** and a
worst-case top-10 overlap of 7.

Selecting and shaping a session are one step, not two. The whole ranked pool is handed to the
diversity pass with the lead and a session length, and it takes the best candidate that *fits*,
deferring the ones that would break a creator or category rule and stopping at the limit. Both
earlier arrangements were wrong for the same reason: the order the viewer saw was not the order any
rule had checked. Placing the lead on top of a finished list could open a feed with two posts by the
same creator, and drawing the session *before* re-ranking could compose one that no re-ordering
could fix, while compliant posts sat unselected.

Verified by classifying every rule breach in the emitted order against the state that produced it —
*avoidable* when a compliant candidate was still available, *unavoidable* when none was — over 2,000
seeded sessions per catalogue shape (even, creator-skewed, category-skewed, each with and without a
lead cooldown), across sliding windows so the rules run through the batch boundaries rather than
resetting: **zero of either**. On a catalogue that genuinely cannot comply — three creators in one
category, where a twenty-post window cannot hold twenty posts at two per creator — the same
classifier reports zero avoidable and many unavoidable, which is what makes the distinction
meaningful rather than decorative.

For You's session is a *segment* rather than the whole feed, not a cap on the feed: when it is spent
the client opens a fresh one and appends, so scrolling stays continuous and every segment is a new
draw. Posts already shown in that browsing session are never repeated, and events stay attributed to
the session that actually ranked each post rather than to whichever segment is newest. Measured in a
browser: 56 steps past the 40-item boundary, 50 distinct video posts, no duplicate, no stall.

**A session belongs to the person it was built for.** Home and For You pages are keyed by a subject —
the signed-in account, or a guest's own opaque id — and a request without one is answered under a
throwaway subject, which silently starts a *new* session instead of continuing the one asked for.
This was live: a guest scrolling Home opened five sessions in seven scrolls and was served a hundred
rows containing forty-three distinct posts, and the feed could never be exhausted.

A guest's id is now issued at the edge, before any page renders, so the server-rendered first page
and every request after it belong to the same person. Measured from a genuinely clean browser: one
subject, one session of 70, pages of 20 → 20 → 20 → 10, 70 cards on screen, no duplicate, and
"Refresh recommendations" only after the seventieth. Reloading keeps the same person and opens a new
ranking, as it should. The id is opaque, self-generated, bounded and shape-checked, kept out of logs,
and discardable at any time — a visitor who clears it simply becomes a new, unlinked guest.

**Personalization signals.** What a person watches, likes, comments on, shares, follows, quick-skips,
or (for photos) how long they dwell on a post all feed a decaying affinity score per category,
hashtag, and creator (older signal matters less, with a two-week half-life). A guest, or an
authenticated person with no history yet, gets a simpler mix — recent-popular, fresh, and
category-diverse — rather than a fabricated preference profile. A guest can still get session-level
learning during one visit if the client sends an opaque, self-chosen anonymous session id; nothing
here fingerprints a device.

**Cold start.** A post with zero interactions is not penalized to invisibility, and is not guaranteed
the top slot either — it gets a bounded exploration bonus that shrinks as it accumulates impressions,
and one creator cannot flood the fresh pool with new posts to game this.

**Trending, done with statistics.** A trending post is not simply "most likes" — a small sample (one
like on one impression) is smoothed toward a category-typical baseline (Bayesian smoothing), and
older engagement is discounted by time decay, so a post from months ago cannot permanently outrank a
well-performing new one.

**Feedback loop.** The client reports impressions (post visible ≥50% of its card for ≥1s), watch
completion/quick-skip, photo dwell time, and detail opens; likes/comments/shares/follows are also
reported to the recommender (in addition to the normal like/comment/share/follow endpoints, which are
unchanged) so later sessions can reflect what was just watched.

**Debugging.** Outside production, a request can ask for a `debug=true` breakdown of each candidate's
source bucket and score components; production responses never include it.

## API

- `GET /posts/home-posts` — Home/Topic, ranked by the recommendation engine. Accepts `topicKey`
  (category tab — every candidate source is scoped to it), `sessionId` + `cursor` (continue a
  session), `sessionId` + `rollover=true` (continue the *chain* in a new session — see
  "Scrolling past one session" below), `anonymousId` (guest session learning), `debug`
  (non-production only).
- `GET /posts/recommended` — For You, same session/cursor/anonymousId/debug contract as above,
  scoped to the For You candidate quota and weights instead of Home's.
- `POST /posts/recommendation-events` — batched impression/watch/quick-skip/photo-dwell/detail-open/
  like/comment/share/follow_after_view telemetry that trains the engine.
- `POST /posts/:id/detail-session`, `GET /posts/detail-session/:sessionId/next|previous` — Post
  Detail recommendation sessions for Home/notification/message/direct-link anchors. `next` accepts
  `videoOnly=true`, used by the picture-in-picture window, which can only draw a post that carries a
  video.
- `GET /posts/creator-posts` — **one creator's posts**, pinned first, in the creator's own order.
  Requires `userId`; a request without one is refused rather than answered with a feed.
  `creatorOrder=latest` (2026-09-10) returns the same posts plain newest-first (`createdAt`, then
  `_id`) with the plain cursor; the header account menu's "My work" preview uses it so an old pinned
  post cannot displace the newest ones. Absent or `pinned` keeps the pinned-first order. Used by the
  creator profile grid (its server-rendered first page *and* every page after it) and the Post Detail
  **Videos** tab. The profile grid pages this route as the viewer reaches the end; it previously could
  not page at all, and the hook behind it was wired to the signed-in caller's own listing. This route exists because `/posts/home-posts`
  used to serve it and stopped: when that route became the ranked Home feed it lost the `userId`
  filter entirely, so every creator listing quietly returned the whole ranked feed (measured: a
  request for one creator answered with posts from eight, rendered under that creator's name).
- `GET /posts/following` — unchanged, plain chronological.
- `GET /posts/:id`
- `POST /posts/:id/view`
- authenticated owner listing through `GET /creator/posts` or `/creator/posts/search`

Every candidate query filters active content and excludes deleted-author content and either-direction
blocked creators (never `restrict`, which is a messaging-only signal in this codebase).

Opening a post detail records one view for that post during the mounted popup session. Views made by the post owner are excluded. The API persists the non-negative `totalView`, returns the authoritative total, and profile-owner cards update immediately. The `1785772800000-add-post-total-view.js` migration backfills existing posts to zero before the field is relied on.

`user/src/hooks/use-home-feed-infinite-scroll.ts` and `use-recommended-videos.ts` (For You) both page
through a `sessionId` + opaque `cursor`, never a `createdAt`/offset scheme. `use-following-feed.ts`
owns the authenticated following feed and is untouched by the recommendation engine. Creator profile
loading uses `use-creator-post-search.ts` and `use-creator-videos.ts`; there is no `/posts/infinite`
or bookmark feed.

## Scrolling past one session (revised 2026-09-06)

A ranked session is a bounded **sample** of the candidate pool, not the
catalogue: Home shows 70 of the 160 eligible posts, For You 40. That bound is
deliberate — it is what makes a reload a genuinely new selection instead of a
re-sort of one fixed set.

It used to also be where Home stopped, at about 70 posts. Two attempts to fix
that failed in opposite directions, and both are worth recording:

- Home reached **89** posts and reported "recommendations are exhausted"; a
  reload after that served only **11**. The app was treating "posts this account
  saw at some point recently" as a hard rule about what it may show *now*, so an
  engaged visitor gradually starved their own feed.
- The next attempt let an exhausted browse start the catalogue over. It never
  stopped: Home grew to **410 cards** of a 160-post corpus, openly repeating
  itself.

### What happens now

Home and For You both browse in a **chain**: several ranked sessions linked
across one page load. When a session is spent the app asks for a successor,
ranked over the posts the chain has not served yet.

- Ranking, diversity, personalization and the category scope are unchanged.
  Each session in a chain is a full, independently ranked selection, and For You
  keeps its own personalized ranker.
- **Every post appears at most once in a browse.** Roughly 160 unique posts on
  the current catalogue — never the same post twice, and never a multiple of the
  corpus.
- Posts seen in *earlier* browsing are strongly preferred against, but never
  allowed to empty the feed. That distinction is what fixes the 89/11 failures.
- When the remaining unseen set is too small to fill a session, those posts are
  served anyway — a short batch, not a dead end.
- When the browse has served everything eligible it **stops** and shows its end
  state. It does not start over on its own.

### Seeing the catalogue again is your decision

Three things start a fresh browse, and only these three:

- **"Refresh recommendations"** at the end of the feed;
- **reloading the page**;
- **switching Home category**, which is its own browse — so a small category is
  never emptied by what "All" already showed.

Two tabs browse independently and never consume each other's posts.

**For operators:** the chain's memory lives in Redis under
`reco-chain:<feed>:<id>:{meta,seen}`, expires two hours after the last activity,
and is capped so one long scroll cannot grow it without bound. No new
environment variable or configuration is needed.

## Like counts and liked state stay in step (2026-09-06)

The same post can be on screen in several places at once — the detail modal and
the creator "Videos" list beside it, a search result behind them, a Home card
underneath. Liking it in any one of them now updates all of them immediately,
including the red heart and the total, and unliking does the same.

Two things this fixes:

- liking from the detail modal used to leave the same post's card in the Videos
  tab showing the old total, visibly, side by side;
- opening an already-liked post **from search** used to show the correct total
  with a **white heart**, because the search summary answered without knowing
  who was asking. Both the server (search now answers as the viewer) and the
  modal (which confirms the viewer's own state once per open) were corrected, so
  every way of opening a post now agrees.

A realtime update from someone else liking the post is applied as an absolute
value, so it can never double-count against your own click.

## Pinned badges only on the creator's own collection (2026-09-06)

"Pinned on top" describes where a post sits in **its creator's** profile
ordering. It is shown on the creator's Works grid and on the Videos grid inside
the post popup, and nowhere else — not on your "I like it" tab, not in search,
not on Home or For You. A liked post from another creator used to carry the
badge into your likes, where their pinning means nothing.

Nothing about the post changed: pinning still works and still orders the
creator's own profile exactly as before.

## Opening a post from search navigates recommendations (2026-09-06)

Next/previous inside the popup follows the post-detail recommendation sequence
whichever page opened it, so search now behaves like Home. It previously walked
the search results instead — and after opening and closing a creator's "Videos"
tab that looked like the tab had never closed, because a search for a creator
returns their posts and nothing else.

The Videos tab itself is unchanged: while it is open, up/down moves through that
creator's videos; closing it (the large Back button, or the avatar) returns to
the recommendation sequence from the post you are on.

## The creator Videos tab keeps its list (2026-09-06)

Opening a creator's videos, closing the post, and opening that creator again
used to leave a single video and "All videos loaded". The list is now cached per
creator for as long as the page is open, so reopening restores the full list and
its pagination, and each creator's list stays its own.

## Picture-in-picture next/previous (revised 2026-09-06)

Popping a video out into the floating player gives it its own next/previous controls. They used to
step through the Home grid **in the order the page happened to have rendered it** — so "next" was
whichever card sat below the one playing, and scrolling the page underneath changed what "next"
meant.

They now behave like the post-detail viewer, without leaving the PiP window and without opening a
tab or a Videos page:

- **Next** asks the same anchor-based Post Detail recommendation session the detail viewer uses,
  restricted to video posts. It never returns the post that is playing, and never one this PiP
  session has already shown.
- **Previous** walks back through what this PiP window actually played, replaying it exactly — never
  a fresh recommendation.
- Stepping back and then forward again replays the same post rather than recomputing one.
- When the recommendation session runs out, next wraps deterministically to the first video this
  window played, so the sequence repeats in a predictable order rather than picking at random from
  posts just rejected.
- The mute/unmute choice carries across a track change. It used to reset on every "next".

## Post Detail (since 2026-09-03)

Opening a post from Home or a `modal_id` link (notification, shared-post message, bookmark) no
longer navigates next/previous by grid order. It opens an anchor-based Post Detail recommendation
session server-side; "next" asks the session for a new recommended post (never simply the next grid
card), and "previous" replays exactly what was already shown in this open — no recompute, no
duplicates. Opening from For You continues to use For You's own already-ranked session array
instead.

**Three navigation modes (revised 2026-09-03).** At any moment exactly one list owns "current post",
next, previous and prefetching:

| Panel state | Mode | What next/previous move through | May change creator | Scroll moves the post |
|---|---|---|---|---|
| nothing open | recommendation | the recommendation session | yes | yes |
| **Videos** tab open | creator | that creator's posts, pinned first | no | yes |
| any other tab (Details, Comments, Related, Ask AI) | locked | nothing | n/a | no — the panel scrolls |

The creator is captured when the Videos tab opens and held unchanged until it closes, so a late
response naming somebody else cannot re-point the sequence, and stepping between a photo post and a
video post — which swaps the whole layout — does not lose it. Any item the creator query returns
that does not belong to the captured creator is dropped rather than rendered.

The sequence also refills ahead of the open post rather than one at a time on reaching the end, and
the "next" control stays available while a refill is in flight instead of reporting the end of the
feed. Before this, an ordinary view-count update could cancel a refill that had already succeeded,
and nothing rescheduled it: the sequence ended at the second or third post with the catalogue barely
touched.

Every view is tracked: an impression once a card/post is at least half visible for at least a
second, watch completion/quick-skip/replay for video, dwell time for photos, and a `detail_open`
plus like/share/follow signal for whatever gets opened. A `follow` is only ever counted toward
"discovered via recommendation" once it can be verified against a real, recent exposure to that
creator's content — a client cannot manufacture the signal by claiming it. All of this telemetry is
batched client-side and still gets flushed if the tab closes mid-watch.

## Signal integrity (updated 2026-09-03)

Everything the client reports is treated as a *claim* and re-derived or re-checked server-side before
it can move anyone's recommendations:

- **Quick skip is never sent by the client.** The server classifies it from the watch numbers a
  `final_watch` carries — a low share of the video watched *and* a short absolute time, both required,
  so a two-second video watched nearly to the end is not mistaken for a skip. A video that never
  actually started (autoplay blocked, or scrolled past before playing) reports nothing at all and is
  not penalised.
- **"Watched to the end" is checked, not accepted.** A completion only counts when the watch time
  reported alongside it genuinely clears the threshold against the server's own canonical duration for
  that video. A legacy video with no stored duration can never be counted complete.
- **Replays count, but not infinitely and not twice.** Each replay carries its own id, so a network
  retry of the same replay is recognised as the same one, while a genuine second replay counts. A
  small per-video ceiling stops anyone inflating the signal by seeking start-to-end repeatedly.
- **Late or out-of-order reports never make a number go backwards.** A stale flush that arrives after
  a newer, larger one is discarded rather than overwriting it. Two separate viewings of the same post
  are counted separately and never merged.
- **A comment signal is checked against the real comment** — that it exists, that the person claiming
  it wrote it, and that it belongs to that post (through its parent, for a reply). A reply counts once,
  as one comment, against the post it belongs to. Deleting a comment later never drives any counter
  negative.
- **Identity always comes from the signed-in session**, never from anything the request body claims,
  and a signed-in request cannot merge a guest's history into the account.

## Post Detail from a shared-post message (since 2026-09-03)

Opening a post from a shared-post message in Messages now opens it in the normal Post Detail modal —
in place, with the conversation still open behind it — and it is recognised as a message-originated
open rather than an anonymous link. It gets the same anchor-based recommendation sequence Home and
notification opens use: "next" is a recommendation, "previous" replays what was already shown, and
switching to the creator's **Videos** tab still switches to that creator's own posts. From the
dedicated `/messages` page, which renders no modal of its own, it falls back to home and opens there.

## Demo dataset (updated 2026-09-03)

`yarn demo:seed` now gives each of the sixteen demo accounts its own viewing history, so signing in as
different accounts shows genuinely different feeds instead of the same one. Each account's taste is
derived from its own theme plus two related categories — `maitran.eats` leans food, then travel and
photography; `tomasberg.plays` leans games, then anime and knowledge — and nothing about those
personas is known to the recommender itself: they are ordinary viewing events, and deleting them makes
every account identical again.

Sixteen posts (one per creator) are left deliberately untouched — no likes, comments or shares, and
only a couple of impressions — so the "new post nobody has seen yet" path has something real to work
on. `yarn demo:verify` checks all of this, re-deriving the stored totals from the raw events rather
than trusting them.

Signing in **locally**: any seeded address (for example
`maitran.eats@demo.invalid`) with the fixture password in `api/demo/demo.config.js`.
That fixture is committed to a public repository and is a local convenience only
— the deployed environment's demo accounts use a separate credential held in
`deploy/.env` (`DEMO_ACCOUNT_PASSWORD`) and are not publicly signable.

## What a signed-out visitor sees (clarified 2026-09-03)

A guest is **not** served "trending only". Their feed is drawn from three pools — roughly half
recent-popular, a third newly-posted or barely-seen, and the rest picked for category variety — and a
single guest session spans 13 of the 13 active categories. What a guest does *not* get is
personalisation: no interest score is applied to anything they are shown, no history is read, and
nothing is written back. Reloading gives a new mix and a new order.

Two defects behind this were found and fixed on 2026-09-03:

- **A first-time visitor could get a broken Home.** Before the client had stored its anonymous id, the
  feed request failed outright. It now returns a normal, non-personalised feed.
- **Two of the five content pools were silently returning nothing** on this dataset, so every feed —
  guest and signed-in alike — was quietly built from recent posts only. Fixed; a guest session now
  covers the whole catalogue rather than a fraction of it.

A third: **an active viewer could be shown an empty feed** because the engine avoids repeating what
you have already seen, and someone who has seen nearly everything was left with nothing. Repeats are
now preferred to an empty screen.

## Known limitations

- **Creator variety thins out deep into a very long session**, once the pool of unshown posts is
  nearly used up — past roughly the sixth screen on a catalogue small enough that one session covers
  most of it. The first several screens are unaffected in every session measured, category variety
  holds throughout, and starting a new session or refreshing restores it. How it behaves against a
  much larger, less evenly distributed catalogue has not been measured. Tracked as
  `.agents/bug-tracker/rec-recommendation-diversity-tail-starvation.md`.

See `.agents/skills/recommendation-engine/SKILL.md` for the implementation contract and file paths.
