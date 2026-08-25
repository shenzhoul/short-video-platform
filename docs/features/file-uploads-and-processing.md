---
title: File Uploads and Processing
description: Authorized direct/TUS uploads, ownership references, disk storage, and media processing.
audience: [creator, admin, operator, developer-agent]
domain: file-service
status: active
updated: 2026-08-25
tags: [upload, tus, image, video, ffmpeg, limits, policy]
---

# File Uploads and Processing

## Workflow

1. The user/admin client requests an upload URL through a domain API endpoint.
2. The API asks the file server for a direct or TUS upload location with signed context.
3. The client uploads to the file server and receives file metadata/ID.
4. A profile, post, or setting mutation validates ownership and persists the reference.
5. Queue listeners/processors handle media work and unused-file cleanup.

Images use Sharp. Videos use FFmpeg/FFprobe and optional hardware acceleration. Large processing work can run through BullMQ.

## Upload limits, per file type

Updated 2026-08-24. Every upload type has its own policy. Before this, only
comment images were bounded — every other upload was checked for *being* an image
and for nothing else, and videos were not content-checked at all.

The numbers live once, in `shared/upload-policy`, and the browser, the API and the
file server all read them from there. The browser refuses early so a hopeless file
never costs a transfer; the API refuses a declared size before it creates a record;
**the file server measures what actually arrives and is the only authority.**

The table below is the **default**. Most of these numbers can be changed without a
deploy — see [Adjusting the limits](#adjusting-the-limits).

| What you are uploading | Type | Max size | Max resolution | Other limits |
| --- | --- | --- | --- | --- |
| Comment image | `comment-photo` | 10MB | 12000px a side, 40MP | 300 frames, 30s of animation. GIF allowed. |
| Message photo | `message-photo` | 10MB | 12000px a side, 40MP | 300 frames, 30s of animation. GIF allowed. |
| Post photo | `post-photo` | 20MB | 12000px a side, 60MP | Stills only — no GIF. |
| Custom post cover | `post-thumbnail` | 5MB | 4096px a side, 16MP | Stills only. |
| Profile avatar | `avatar` | 5MB | 4096px a side, 16MP | Stills only. Cropped square in the browser first. |
| Creator cover | `cover` | 10MB | 8192px a side, 40MP | Stills only. Cropped 10:3 in the browser first. |
| Admin setting image | `setting-file` | 10MB | 8192px a side, 40MP | 300 frames, 30s. GIF allowed. |
| Post video | `post-video` | 500MB | 3840x2160 | 10 minutes, 60fps |
| Post teaser | `post-teaser` | 200MB | 3840x2160 | 60 seconds, 60fps |
| Message video | `message-video` | 200MB | 3840x2160 | 5 minutes, 60fps |

Accepted image formats are JPEG, PNG, WebP, AVIF/HEIC — plus GIF for the three
types that keep animation. SVG is never accepted: it is a scriptable document
rather than a picture. BMP, TIFF and RAW were advertised by some pickers and have
never been decodable; those pickers now advertise only what works.

Accepted video containers are MP4, MOV and WebM, carrying H.264, HEVC, VP8, VP9,
AV1 or MPEG-4 video and an optional AAC/MP3/Opus/Vorbis/AC-3/PCM/ALAC/FLAC track.
Video resolution is orientation-aware, so a 2160x3840 portrait clip is as
acceptable as a 3840x2160 landscape one.

### What a rejection tells you

Rejections are reported with a stable code, and the app shows a different message
for each because they ask for different things:

| Code | HTTP | What it means |
| --- | --- | --- |
| `INVALID_IMAGE_FORMAT` / `INVALID_VIDEO_FORMAT` | 400 | Not the kind of file it claims to be, or corrupt/truncated. Pick a different file. |
| `IMAGE_FILE_TOO_LARGE` / `VIDEO_FILE_TOO_LARGE` | 413 | A fine file, too many bytes. Save or export it smaller. |
| `IMAGE_DIMENSIONS_EXCEEDED` | 400 | Too much picture: width, height, pixels, frames or playing time. |
| `VIDEO_DURATION_EXCEEDED` | 400 | The clip is too long. |
| `VIDEO_RESOLUTION_EXCEEDED` | 400 | The frame is too large. |
| `VIDEO_FRAME_RATE_EXCEEDED` | 400 | Above 60fps. |
| `VIDEO_CODEC_NOT_SUPPORTED` | 400 | A codec the pipeline cannot transcode. |
| `UNSUPPORTED_UPLOAD_TYPE` | 400 | The upload type is not one the system knows. This is a bug on our side, not a problem with the file. |
| `UPLOAD_VALIDATION_BUSY` | 503 | The server is validating as many uploads as it can at once. Retry shortly. |

Comment images keep their own three codes (`COMMENT_IMAGE_*`) because the comment
composer matches on them specifically.

### Roles

- **Guests** cannot upload anything.
- **Users** can upload avatars, comment images and message attachments.
- **Creators** additionally upload post photos, videos, teasers and custom covers,
  once their documents are verified.
- **Admins** upload setting images through **Admin → Settings**; the same limits apply.
- **Operators** can tune concurrency with `IMAGE_VALIDATION_CONCURRENCY` (default 3)
  and `VIDEO_PROBE_CONCURRENCY` (default 2) on the file server. There is no admin
  screen for the upload limits themselves — they are code, in `shared/upload-policy`,
  because the browser and both services have to agree on them exactly.

Existing files are not re-checked. The policies apply to new uploads only.

## Adjusting the limits

**Admin → System → Settings → Upload limits.** Updated 2026-08-24.

Every type above has its own fields on that screen, named `<Type> · <Limit>`:

- **Images** — Max file size (MB), Max width (px), Max height (px), Max pixels (MP),
  Max frames, Max animation duration (seconds).
- **Videos** — Max file size (MB), Max width (px), Max height (px),
  Max duration (seconds), Max frame rate.

Save takes effect on the **next upload**. Nothing needs restarting: the API keeps
the settings in memory, refreshes that on write, and tells other instances over
Redis. An upload already in progress keeps the limits it started with, because
they were written onto its file record when its upload token was issued.

### What cannot be changed here

Allowed image formats, video containers and codecs, the magic-byte checks, the
cleanup behaviour, the durable-type dispatch, validation concurrency and process
timeouts are all code. They are correctness and safety machinery rather than
policy: accepting TIFF because somebody typed it into a form would mean accepting
a file the pipeline cannot decode.

### Hard ceilings

No setting can go past these, and the form says so under each field:

| | Images | Videos |
| --- | --- | --- |
| Max file size | 100MB | 2048MB |
| Max width / height | 30000px | 7680 / 4320 |
| Max pixels | 200MP | – |
| Max frames | 2000 | – |
| Max duration | 120s | 60 minutes |
| Max frame rate | – | 240fps |

### If a value is rejected

Saving is refused, with the reason, and **the stored value is left exactly as it
was**. A value is rejected when it is not a number, is zero or negative, is empty,
is above the hard ceiling, or contradicts another limit — a pixel budget below the
width limit, for instance, makes that width unreachable, and the message names the
number that has to move.

### If a setting is missing or broken

Each limit falls back to the code default on its own. A blank database needs no
setup at all: the defaults are what the system uses, and the migration only makes
them visible and editable. One unusable value costs that one limit its override
and leaves the rest of the policy alone.

Post videos request three WebP thumbnails. FFmpeg extracts all three at evenly spaced timestamps even for videos shorter than three seconds. These are normal thumbnails used as creator cover recommendations; the separately generated `blurImage` remains a media fallback and must not be treated as a post cover.

## Profile images

`PUT /users/me/avatar`, `PUT /users/me/cover` and the admin
`PUT /admin/users/:id/avatar` all end in one method in `BaseUserService`. The
controllers no longer validate or reference anything themselves — a fourth caller
cannot skip a step that lives in the service.

### What happens, in order

```text
validate the file → claim it → atomically swap the pointer → retire the old image
```

1. **Validate** against the record the file server wrote, never against the
   request. The file must exist, be a durable `avatar` (or `cover`) upload, have
   finished processing without error, belong to the profile's owner, and not
   already be on somebody else's profile.
2. **Claim** it: ownership transfers to the profile's owner and a `user`
   reference is added. The file server reports how many records it matched, and a
   zero fails the request.
3. **Swap** the pointer with a single atomic update that returns the document as
   it was, so the request learns exactly which image it displaced.
4. **Retire** the displaced image: drop its reference, then delete it.

### Why that order

The user document and the file server have no shared transaction, so each step is
placed where its failure lands somewhere recoverable. The unused-file job decides
what is abandoned purely from references, which makes two states forbidden: a
profile pointing at an unreferenced file (deleted within hours — a broken
profile), and a referenced file no profile points at (nothing will ever collect
it).

| Where it fails | Profile | Old image | New image |
| --- | --- | --- | --- |
| Validation | unchanged | untouched | never claimed |
| Claim | unchanged | untouched | unreferenced → swept |
| Pointer swap | unchanged | untouched | unreferenced, then deleted |
| Retiring the old image | **updated, correct** | unreferenced → swept | live |
| Crash after claim, before swap | unchanged | untouched | referenced leftover → audit |
| Crash after swap, before retire | **updated, correct** | referenced leftover → audit | live |

No row leaves a viewer looking at a broken profile. The two crash rows are the
only ones that need the audit script, and both are invisible leftovers rather
than damage.

### Concurrency

Two people (or two tabs) changing the same image at once each retire exactly the
image they displaced, because the displaced id comes from the atomic swap rather
than from a read taken earlier. The last write wins, its file keeps its
reference, and every intermediate file is deleted. Changing an avatar and a cover
at the same time cannot interfere: they set different fields. A file that is
currently a profile's avatar *or* cover is never deleted.

### What a client sees when a file is refused

| Status | Meaning |
| --- | --- |
| 404 | No file with that id |
| 403 | Not that kind of upload, or not the caller's file |
| 409 | Processing failed or unfinished, or the file could not be claimed |

In every case the profile keeps the image it had, and the right response is to
ask the person to upload again. The user and admin apps surface the message
rather than failing silently.

### Repairing existing data

`api/scripts/audit-profile-image-refs.js` reports and repairs profile images
whose references drifted — from a deployment that predates the ordering above, or
a crash in one of the two windows. It reads the API database and the file server
database, so it needs both connection strings, and it is **dry run by default**:

```bash
cd api
node scripts/audit-profile-image-refs.js                            # report only
node scripts/audit-profile-image-refs.js --apply                    # write repairs
node scripts/audit-profile-image-refs.js --file-server-uri=mongodb://host/douyin-clone-file-server
```

`FILE_SERVER_MONGO_URI` is used when the flag is absent. It reports five things:

- **missing reference** — the sweeper would delete a live profile image. Repaired
  by adding the reference.
- **stale reference** — a leftover no profile points at and nothing would ever
  collect. Repaired by removing the reference, which hands the file to the
  unused-file job; the bytes go on its next run, through the same deletion path
  everything else uses.
- **dangling pointer** — the image is already gone. Reported only.
- **unusable image** — a profile is serving an image whose processing failed.
  Reported only; somebody has to upload a new one.
- **shared between profiles** — left alone rather than resolved in favour of one.

Re-running finds no work. It is a maintenance tool: never run at startup, never
on a request path, and not needed at all on a fresh database.

Operators upgrading a deployment that predates 2026-08-25 should run the dry run
once before the cover sweep goes live, and `--apply` if it reports anything.

## Message attachments

`POST /content/files/message/photo/upload` and `POST /content/files/message/video/upload` issue upload URLs for direct-message attachments, with types `message-photo` and `message-video`.

They are deliberately separate from the post upload endpoints rather than reused. The post endpoints gate on creator document verification, which is correct for published content and wrong for a private message — anyone able to hold a conversation must be able to send a picture in it. They also generate a `blurImage`, which a direct message has no use for, since both participants may see the attachment in full.

The message is created only after the upload returns a file id, so a message row can never reference an incomplete upload. Abandoned uploads are swept by the unused-file job (every four hours, since 2026-08-24): `MessageService.send` adds a `message` reference to every attachment it stores, so anything still unreferenced after the delay is a picture somebody chose and never sent.

`StorageService` currently selects `DiskStorageService`; S3/CDN configuration placeholders do not provide a cloud-storage adapter.

See [the file-service domain](../domains/file-service.md) for internal routes and production secret requirements.
