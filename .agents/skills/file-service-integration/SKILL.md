---
name: file-service-integration
description: End-to-end upload and media-processing workflow for Douyin Clone across api, file-server, user, and admin. Use for signed uploads, TUS resumable uploads, file ownership, image/video processing, or API media references.
---

# File Service Integration

Trace the complete flow before changing it:

1. the client requests an upload target from the API;
2. the API delegates to `FileServerService`;
3. the client uploads directly or through TUS;
4. the file server stores metadata and runs image/video processing;
5. the API validates ownership before attaching a file to identity or content;
6. API DTOs return the media data consumed by the frontend.

## Current References

- `api/src/services/shared/file-server/file-server.service.ts`
- `api/src/controllers/content/content-file.controller.ts`
- `api/src/services/identity/identity.file.service.ts`
- `api/src/services/identity/user/base-user.service.ts` — avatar/cover claim order
- `api/scripts/audit-profile-image-refs.js` — profile image reference repair
- `api/src/services/content/content.file.service.ts`
- `file-server/src/controllers/internal/`
- `file-server/src/services/file/`
- `file-server/src/services/tus/`
- `user/src/services/file-upload.service.ts`
- `user/src/hooks/use-file-upload-server.ts`
- `admin/src/services/file-upload.service.ts`

## Invariants

- Validate type, size, ownership, and intended use on the server.
- **Decide what a file *is* from its bytes, never from what the request says it
  is.** `accept="image/*"`, the `File.type` a browser reports, the extension, and
  the TUS `filetype` metadata are all chosen by the uploader — every major
  browser derives `File.type` from the extension, so renaming `clip.mp4` to
  `clip.png` changes all four at once. `isImage()` in `file-server/src/lib/file-type.ts`
  reads only those claims and cannot be the check that matters.
  `ImageContentValidationService.assertDecodableImage` reads the header and then
  decodes, and both halves are required: the sniff is what refuses **SVG**, which
  Sharp rasterises perfectly well and which is a scriptable document rather than
  a picture; the decode is what catches a truncated or corrupt file behind an
  intact header. Comparing a declared media type against a declared MIME type —
  which is all `validateMediaTypeConsistency` does — is two claims agreeing with
  each other.
- **Bytes are not a size limit.** Compressed size says almost nothing about what
  a decoder must hold: a flat 6000x6000 PNG is 120KB on disk and 36 million
  pixels in memory, and the same trick at 30000x30000 stays under 10MB while
  asking for nine hundred million. Bound each side, the **total decoded pixels**,
  and the **frame count** as well as the bytes — an animated GIF can be tiny and
  still decode to hundreds of megapixels across its pages.
- **Apply the budget before the decode, through the decoder.**
  `sharp(path, { limitInputPixels })` is enforced by libvips when the image is
  *opened*: `metadata()` on an oversized file throws rather than returning, so
  the pixels are never allocated. Checking `width * height` after a decode is not
  a limit, it is a post-mortem. Never pass `limitInputPixels: false`. Reading a
  header needs a bounded ceiling above the budget so a rejection can report the
  real dimensions — that ceiling is not a way around the budget, and every path
  that decodes still uses the budget itself.
- **With `animated: true`, `metadata().height` is every frame stacked.**
  `pageHeight` is the real per-frame height; using `height` rejects a legitimate
  animation for being as tall as all its frames put together. `pages` is the
  frame count, and `width * pageHeight * pages` is what a decoder actually holds.
- **A refused upload leaves no record in any state.** Marking one `status: error`
  keeps a row nothing can use, that the unused-file sweeper has no reason to
  collect, and that a client can still name in a later request. Delete it, bytes
  first so a crash mid-purge leaves an orphan the sweeper *will* collect rather
  than a record pointing at nothing.
- **`@tus/server` swallows what `onUploadFinish` throws** and answers 204 unless
  the error carries `status_code` and `body` — a NestJS `HttpException` has
  neither, so the client sees a generic 500 with no code. Re-raise a rejection in
  that shape, and re-raise **only** the rejection: a genuine processing failure
  should still be absorbed, because the upload itself succeeded and the retry and
  sweep paths already cover it.
- Use TUS for resumable/large uploads and preserve upload progress and recovery behavior.
- In Next.js frontend services, load `tus-js-client` dynamically inside the browser upload operation. A static import can pull its Node lockfile dependency into the dev-server HMR graph, repeatedly register process signal listeners, and trigger `MaxListenersExceededWarning` after many recompilations. Do not mask that leak with `process.setMaxListeners()`.
- Persist file references only after the owning entity is successfully saved.
- Use API-returned URLs and metadata rather than constructing storage paths in the frontend.
- Keep image work with Sharp and video work with the current FFmpeg/BullMQ flow.
- Clean abandoned drafts and unused uploads through the existing jobs.
- Never expose internal signing secrets or storage paths.
- Never authenticate an internal or administrative file-server route with a JWT verified against `JWT_SECRET`. That same secret signs the upload, TUS, and signed-URL tokens handed to browsers, so "the signature is valid" means "some user is uploading", not "the API is calling". `/internal/files/*` takes service API keys only — `InternalApiGuard` requires `X-API-Key` (`API_SECRET_KEY`) plus `X-Internal-API-Key` (`INTERNAL_API_KEY`), compared in constant time. This was a live critical defect until 2026-08-22; the guard it replaced checked nothing but the signature.
- Every issued token carries a `purpose` claim — `file-upload`, `tus-upload`, `signed-url` — and the consuming path verifies it. Do not distinguish token families by which fields happen to be present.
- Signing secrets have no fallback value. `getFileSigningSecret()` throws when `JWT_SECRET` is unset rather than signing with a default; a literal key in a public repo is a published key.
- Post-video uploads generate three normal thumbnail recommendations. Keep short-video extraction at three frames and do not substitute `blurImage` for a creator-selected cover.
- Custom post covers are independent owned file references for `4:3` and `3:4`; include both in ownership updates and deletion cleanup.
- Multi-image graphic drafts mirror video drafts: upload `post-photo` files before post creation, persist only creator-scoped file IDs and editor metadata in browser storage, restore through an authenticated ownership-checked API, and batch-discard only unreferenced owned files. Reordering or selecting a cover must not duplicate the physical file.
- Validate processed draft media with durable record fields such as the top-level `type`. Do not require upload-request metadata like `category` or `fileType`, because processing normalization may remove those fields.
- Disk cleanup must canonicalize and deduplicate absolute/public path aliases before unlinking. Retry transient Windows `EBUSY`, `EPERM`, and `EACCES` errors, and propagate exhausted deletion failures so the queue can retry instead of orphaning media.
- After transcoding to a distinct browser-compatible video, persist the final output reference before deleting the superseded source. Compare canonical source/output paths rather than the upload record path, and constrain hardware-encoder bitrate or quality so compatibility conversion cannot expand files without a bound.
- When discard races queued or active media processing, atomically tombstone the record and let the worker that owns FFmpeg/Sharp handles perform physical cleanup and hard-delete the tombstone. Workers must reject writes to deleted records and make both the pre-claim and post-processing discard paths idempotent.
- Keep Sharp/libvips file-descriptor caching disabled in the file-server process on Windows-compatible deployments. Reading generated thumbnail metadata by path can otherwise retain permanent handles and make every physical deletion retry end in `EBUSY`; memory and operation caches may remain enabled.

## Profile images (avatar, cover)

One write path — `BaseUserService.applyProfileImage`, reached from
`PUT /users/me/avatar`, `PUT /users/me/cover` and the admin
`PUT /admin/users/:id/avatar`. The reference lifecycle is the same as a comment
image's with the **order deliberately reversed**, and the reason is the reusable
part.

```text
validate the file → claim it → atomically swap the pointer → retire the old image
```

- **Claim before the pointer, not after — and understand why it differs.**
  - A comment is a **new row**. Referencing first risks a file nothing points at:
    a leak the sweeper reclaims, because the file stays unreferenced.
  - A profile image **replaces a pointer on a row that already exists**. Pointing
    first risks a live profile whose image carries no reference, and both
    `avatar` and `cover` are swept — the image dies within hours and the profile
    serves a URL whose bytes are gone.
  - Read the rule as *"never leave a published row pointing at an unreferenced
    file"*, not as *"row first"*. For a new row those are the same sentence; for
    a pointer swap they are opposites.
- **Take the displaced id from the swap, never from a pre-read.** The pointer
  swap is one `findOneAndUpdate(..., { returnDocument: 'before' })`. With a
  pre-read, two concurrent replacements both believe they displaced the
  *original*, so both delete it and the intermediate file is left **referenced**
  and therefore invisible to the sweeper — an orphan nothing can ever collect.
  With the before-image each request retires exactly what it displaced. This is
  the single most important line in the path; `profile-image-reference.spec.ts`
  fails five ways if it is reverted.
- **Compensate the swap, don't compensate the cleanup.**
  - Swap fails (or the user vanished) → release the claim: `removeRef` **then**
    delete. Reference first so that a failed delete degrades into the ordinary
    sweeper path instead of a permanent orphan. The profile and the image it was
    already showing are untouched.
  - Retiring the old image fails → **do not roll the profile back.** It is
    correct and published; a storage failure is not a reason to un-publish it.
    Dropping the old reference first is what makes even a failed delete
    self-heal.
  - Compensation must never throw. It runs while another failure is already being
    reported, and replacing that error hides what actually went wrong.
- **Re-read the current pointers before deleting anything.** A file can be a
  user's avatar *and* cover at once, and requests interleave. This is what makes
  "never delete the image a profile is currently serving" true rather than
  merely likely.
- **Validate against the file server's record, never the request.** Exists; the
  durable `type` matches the field (`avatar` only becomes an avatar); processing
  finished without error; `createdBy` is the profile's owner — or `'admin'` *and*
  the actor is an admin, which is the only legitimate case, since
  `identity-file.controller.ts` stamps `createdBy: 'admin'` on anything an admin
  uploads; and no `user` reference belongs to a different profile. Four distinct
  refusals, four codes: 404 / 403 (wrong type) / 403 (not owned) / 409 (not
  ready).
- **Check that the claim landed.** `updateFileOwnership` reports how many records
  it matched, and it always writes `updatedAt`, so a matched record always counts
  as updated. `updated: 0` therefore means *no such file* — raise, do not
  proceed.
- **`removeRef` exists now** — `FileService.removeRef` →
  `POST /internal/files/:fileId/remove-ref` → `FileServerService.removeRef`. It
  `$pull`s on both `itemId` and `itemType`, so a file referenced by two items
  loses only the one being detached, and removing an absent reference is a no-op
  rather than an error (compensation can run twice).
- **Clearing a pointer is also a detach.** `deleteUser` nulls `avatarId`, which
  would otherwise strand a referenced file forever. Anywhere a pointer is cleared
  rather than replaced needs the same release.
- **`ObjectId | string` does not fit `fileIds`.** `updateFileOwnership` types it
  as `string[] | ObjectId[]`, so a `(string | ObjectId)[]` fails to compile. Type
  the parameter `ObjectId` rather than casting at the call.
- **Both types are swept** by `cleanup-unused-files.job.ts` since 2026-08-24.
- **`api/scripts/audit-profile-image-refs.js`** repairs the two crash windows,
  dry run by default, spanning both databases
  (`FILE_SERVER_MONGO_URI` / `--file-server-uri=`). It reports missing refs,
  stale refs (repaired by detaching, which hands the file to the sweeper —
  deletion stays in the one code path that does it properly), dangling pointers,
  unusable images and shared files. Idempotent: a second `--apply` finds nothing.
- **Verify a missing-reference claim against real data, not by grepping for
  `addRef`.** `bug-api-profile-image-refs-missing` was filed on exactly that
  search and was wrong: profile images are referenced through
  `updateFileOwnership({ ref })`, which the search never sees. One aggregate over
  the `files` collection settled in seconds what the grep got backwards.
- **Test the file server's storage, not just its records.** The unit harness
  models `refItems` and a `physicalFiles` set separately, because every failure
  here is a *disagreement* between them — asserting on the record alone misses
  half of it. Model behaviour must then be checked against a real running file
  server at least once; that is what caught nothing this time but is the only
  thing that could have.

## Comment images

One optional image per comment, and the lifecycle is the reusable part.

- Upload target `comment-photo`, from `POST /content/files/comment/photo/upload`
  — its own endpoint because the post one gates on creator verification and
  generates a blur placeholder, neither of which suits a comment.
- **`refItems` is the pending/attached state.** Empty means a draft the sweeper
  may collect; populated means it belongs to something. No separate status field
  was added, because that distinction already existed.
- **Reference only after the owning row exists.** `CommentService` creates the
  comment, *then* calls `addRefToMultipleFiles`. Referencing first would let a
  failed insert leave a file that nothing points at and nothing will collect.
- **Attachment re-checks four things** and takes none of them from the request:
  the file exists, the caller uploaded it, its durable `type` is `comment-photo`,
  and it is still unreferenced. A fifth check rejects a record whose processing
  failed — the file server decodes every upload, and attaching one it could not
  read would render a broken box for every reader.
- **A late discard is a no-op, not an error.** `discardCommentImageDraft` refuses
  to delete a file that has since been referenced, so a cleanup request racing a
  successful post cannot strip the picture from it.
- **Deletion goes through `deleteManyByIds`** — tombstone, derivatives, physical
  file, retryable — never a private unlink. Comment first, file second: the worst
  case is then an unreferenced file, which is exactly what the sweeper collects.
- **The sweeper is the safety net.** `comment-photo` is registered in
  `cleanup-unused-files.job.ts`, so a crashed browser, a closed tab or a dropped
  connection cannot leave permanent litter. Client-side cleanup is an
  optimisation, never load-bearing.
- DTOs expose `{ id, url, width, height, mimeType }` only. No storage path.
- **The policy lives in `shared/upload-policy`, and all three apps import it.**
  `@douyin-clone/upload-policy` is a dependency-free CommonJS module (plus a
  hand-written `.d.ts`) holding the limits, the format whitelist, the three error
  codes, their statuses and their messages. `file-server/src/lib/image-content.ts`
  re-exports it, `user/src/hooks/use-comment-image.ts` imports it, and
  `api/src/common/exceptions/comment/invalid-comment-image.exception.ts` imports
  it. It was three hand-kept copies before 2026-08-24, and the copies had already
  started describing different limits.
  - It is **CommonJS with a `.d.ts`, not TypeScript source**, on purpose: `api`
    and `file-server` compile with `tsc` and cannot build a `.ts` file that lives
    under `node_modules`, so shipping source would work in the web app and fail
    in both services.
  - Nothing browser-, Nest- or Sharp-specific may go in it. It is loaded into a
    webpack bundle, two Nest processes and jsdom.
  - **Yarn v1 copies `file:` dependencies rather than linking them**, exactly as
    `shared/toast` documents. Editing the package does not reach the apps until
    you `rm -rf node_modules/@douyin-clone/upload-policy && yarn install --force`
    in each. Two contract specs fail loudly when a copy goes stale —
    `user/src/lib/upload-policy-contract.spec.ts` and
    `api/src/common/exceptions/comment/comment-image-contract.spec.ts` — by
    comparing the installed module against `shared/upload-policy/index.js`.
- **Sharing the numbers does not make the client an enforcer.** Everything the
  composer decides is early feedback: it saves a pointless upload and keeps a
  valid attachment from being replaced by an invalid one. The file server weighs
  the bytes that actually arrive and is the only authority. Never skip a server
  check because the client claims to have run it.
- **Every durable upload type has its own policy. There is no generic tier.**
  `shared/upload-policy/index.js` is the registry — `getUploadPolicy(type)` —
  and it is the single definition the API, the file server and the web client
  all read. Ten types are registered today:

  | Type | Kind | Bytes | Side | Pixels / geometry | Frames / duration | Animation |
  | --- | --- | --- | --- | --- | --- | --- |
  | `comment-photo` | image | 10MB | 12000 | 40MP | 300 frames / 30s | preserved |
  | `message-photo` | image | 10MB | 12000 | 40MP | 300 frames / 30s | preserved |
  | `post-photo` | image | 20MB | 12000 | 60MP | 1 frame | no |
  | `post-thumbnail` | image | 5MB | 4096 | 16MP | 1 frame | no |
  | `avatar` | image | 5MB | 4096 | 16MP | 1 frame | no |
  | `cover` | image | 10MB | 8192 | 40MP | 1 frame | no |
  | `setting-file` | image | 10MB | 8192 | 40MP | 300 frames / 30s | preserved |
  | `post-video` | video | 500MB | 3840x2160 | 60fps | 10 minutes | n/a |
  | `post-teaser` | video | 200MB | 3840x2160 | 60fps | 60 seconds | n/a |
  | `message-video` | video | 200MB | 3840x2160 | 60fps | 5 minutes | n/a |

  Video resolution is **orientation-aware**: the long edge may reach 3840 and the
  short edge 2160 whichever way round the clip was shot, or every portrait phone
  recording would be refused.

  There used to be a `GENERIC_IMAGE_POLICY` that everything except
  `comment-photo` fell into, with no byte, pixel, frame or duration cap at all.
  It was written to undo a worse bug — the comment limits leaking onto uploads
  nobody had chosen them for — but "no limit" is not a policy, it is the absence
  of one. **Do not reintroduce a default.** A default that means "the strictest
  policy in the system" silently re-scopes every upload the first time a feature
  tightens; a default that means "no limits" is what left most of the product
  unguarded. A policy is chosen for a type, and a type with no policy is refused.
- **The registry holds the *defaults*; some numbers are operator-adjustable.**
  Admin → System → Settings → Upload limits, group `upload-limits`, keys
  `upload.limits.<type>.<field>` (`maxFileSizeMb`, `maxWidthPx`, `maxHeightPx`,
  `maxPixelsMp`, `maxFrames`, `maxAnimationSeconds`, `maxDurationSeconds`,
  `maxFrameRate`). Seeded by
  `api/migrations/1787500000000-upload-limit-settings.js` from the registry, so a
  default cannot drift from what the code enforces.

  The path is: `UploadPolicyService.effectivePolicy()` merges the stored settings
  over the defaults and clamps to `UPLOAD_HARD_CEILINGS`; the controller sends
  the result as `uploadLimits` when it asks for an upload URL; the file server
  writes it to `metadata.uploadLimits` on the durable record;
  `resolveUploadPolicy` merges it back and **clamps again**. Two processes, two
  clamps — the one that allocates the memory does not take another process's
  numbers on trust.

  Binding them to the record is what makes an in-flight upload keep the policy
  from when its token was issued, and what keeps the file server ignorant of the
  settings collection. `GET /settings/upload-policies` gives the browser the same
  resolved policies, so all three read one answer rather than three
  reimplementations of the same arithmetic.

  **Do not make a format list, a codec list, a magic-byte check, the cleanup
  behaviour, the type dispatch, a concurrency limit or a process timeout
  configurable.** Those are correctness and safety, not policy. A limit is a
  number an operator can have an opinion about; a whitelist is a claim about what
  the pipeline can decode.

  Adding an adjustable field means adding it to `UPLOAD_LIMIT_FIELDS`, giving it
  a hard ceiling, and re-running the migration — the seed rows and the admin form
  are both generated from the registry.
- **A rejected setting must not disturb the stored one.**
  `SettingService.update` validates before it writes, using
  `validateUploadLimitSetting` from the shared package so the message an operator
  reads and the ceiling the code enforces are the same number. It returns `null`
  for every key this feature does not own, which is what lets it sit on the one
  write path.
- **An unregistered type fails closed.** `getUploadPolicy` returns `null`, and
  every caller turns that into `UNSUPPORTED_UPLOAD_TYPE` — the API before it
  creates a pending record, the file server before it processes one. A typo like
  `post-phto` must never land in a wider policy than `post-photo`, and a type
  somebody forgot to register must surface as a loud 400 rather than as an
  unvalidated file on disk.
- **`publicUpload: false` marks a type a client may not request.** No type uses
  it today; it exists so a server-generated derivative can be added without
  anyone having to remember to guard its endpoint. `UploadPolicyService` refuses
  such a request before a record exists. Note that `post-thumbnail` is **not**
  internal — it is the creator's custom 4:3 / 3:4 post cover and is uploaded from
  the browser like any other picture.
- **Images and videos are validated by different services, in different
  vocabularies.** `image-content-validation.service.ts` sniffs the header, checks
  the format against the policy's whitelist, requires header and decoder to
  agree, and decodes the whole picture with `stats()`.
  `video-content-validation.service.ts` sniffs the container, runs `ffprobe`,
  requires exactly one non-`attached_pic` video stream, whitelists the video and
  audio codecs, checks geometry/duration/frame rate, and decodes a frame near the
  end of the file. Never hand a video to the image validator: an audio file
  renamed `.mp4` is a *valid MP4*, and only counting the streams catches it.
- **`ffprobe` is not proof the video exists.** A faststart MP4 truncated to a
  third of its length still reports a full duration and a healthy stream from its
  header — every check but a decode passes it, and the failure surfaces minutes
  later in the transcode, on a queue, long after the uploader has gone. That is
  what `assertDecodesToTheEnd` is for: `ffmpeg -ss <duration-2s> -frames:v 1
  -xerror`, which costs an index seek rather than a full decode. It is not a
  full integrity proof — corruption mid-file survives it — and the transcode
  remains the authority.
- **Never whitelist a codec because `ffprobe` can read it.** MPEG-2 probes
  perfectly and is refused, because the guarantee is that the pipeline can
  transcode it *and* a browser can play the result. The list is `h264`, `hevc`,
  `vp8`, `vp9`, `av1`, `mpeg4` in `mp4`/`mov`/`webm`, and anything not already
  browser-safe is re-encoded to H.264/AAC by `convert2Mp4`.
- **The policy is chosen from the durable record, never from request metadata.**
  `resolveUploadPolicy(pendingFile)` keys off `pendingFile.type`, which the **API**
  wrote when it asked this service for an upload URL — a server-to-server call
  behind the internal API guard. The TUS upload is bound to that record by a
  **signed token** carrying the file id, so arriving bytes cannot be attached to
  a different record. TUS metadata (`filename`, `filetype`, anything else) is
  chosen by the uploader and must never select a policy: doing so would let
  somebody escape a limit by relabelling their upload, and equally let them
  impose someone else's limits on it. Both directions are covered in
  `scripts/verify-upload-policies.js`.
- **Expensive validation runs behind a concurrency gate.** A 60MP decode is
  seconds of CPU and an FFmpeg probe is a child process, and TUS completions
  arrive whenever transfers happen to finish — nothing else in the request path
  bounds the fan-out. `lib/concurrency.ts` gates both validators
  (`IMAGE_VALIDATION_CONCURRENCY`, default 3; `VIDEO_PROBE_CONCURRENCY`,
  default 2), with a bounded wait that answers `UPLOAD_VALIDATION_BUSY` (503)
  rather than parking a request forever. Every child process has a timeout, is
  SIGKILLed when it overruns, and has its stdout capped. **A slot is released in
  a `finally`** — a rejection *is* the common case here, and a limiter that
  leaked a slot per refusal would seize up after N bad files.
- **Each tier answers in its own vocabulary, and they never share a code.** A
  post photo refused for not being an image answers `INVALID_IMAGE_FORMAT`, never
  `INVALID_COMMENT_IMAGE_FORMAT` — the client matching `COMMENT_*` is the comment
  composer asking about comment rules, and telling it a post upload broke a
  comment rule is telling it something untrue. The full set:

  | Tier | Codes |
  | --- | --- |
  | `comment-photo` only | `INVALID_COMMENT_IMAGE_FORMAT`, `COMMENT_IMAGE_FILE_TOO_LARGE` (413), `COMMENT_IMAGE_DIMENSIONS_EXCEEDED` |
  | every other image type | `INVALID_IMAGE_FORMAT`, `IMAGE_FILE_TOO_LARGE` (413), `IMAGE_DIMENSIONS_EXCEEDED` |
  | every video type | `INVALID_VIDEO_FORMAT`, `VIDEO_FILE_TOO_LARGE` (413), `VIDEO_DURATION_EXCEEDED`, `VIDEO_RESOLUTION_EXCEEDED`, `VIDEO_FRAME_RATE_EXCEEDED`, `VIDEO_CODEC_NOT_SUPPORTED` |
  | any type | `UNSUPPORTED_UPLOAD_TYPE`, `UPLOAD_VALIDATION_BUSY` (503) |

  **413 belongs to the byte limit and to nothing else.** Video codes are split by
  axis on purpose: "too long" and "4K" are different instructions, and a client
  that can only say "video rejected" cannot help whoever picked the file.
  `ALL_UPLOAD_REJECTION_CODES` is what TUS re-raises, built from the registry so
  a new policy brings its codes with it. `UPLOAD_VALIDATION_BUSY` is in that list
  too and is the one refusal that is *not* the file's fault.
- **Three stable codes, not two.** They ask the reader for three different
  things, so folding any pair together loses the only part of the message that
  helps:

  | Code | Status | Message | Means |
  | --- | --- | --- | --- |
  | `INVALID_COMMENT_IMAGE_FORMAT` | 400 | Invalid image format | Not a picture: video, PDF, SVG, wrong magic bytes, header/decoder disagreement, corrupt or truncated. |
  | `COMMENT_IMAGE_FILE_TOO_LARGE` | 413 | Image must be 10MB or smaller | Too many bytes. **Never** used for a resolution problem — a 30000x30000 PNG can be 200KB. |
  | `COMMENT_IMAGE_DIMENSIONS_EXCEEDED` | 400 | Image resolution is too large | Too much picture: width, height, total pixels, frame count or playing time. |

  Raised by the file server (`image-content-validation.service.ts`) and mirrored
  by `InvalidCommentImageException` / `CommentImageFileTooLargeException` /
  `CommentImageTooLargeException` in the API. `COMMENT_IMAGE_FILE_TOO_LARGE` used
  to be reported as `COMMENT_IMAGE_DIMENSIONS_EXCEEDED`, which told people to
  shrink a picture whose resolution was never the problem.
  **Match the code, never the message text** — the wording is free to change or
  be translated on either side. The codes have to survive the TUS transport too:
  `REJECTED_UPLOAD_CODES` in `tus-server.service.ts` lists all three, and
  `asTusError` puts the status and the JSON body where `@tus/server` will find
  them (it otherwise answers a generic 500 with no code to match on).
- **Limits for `comment-photo` and no other type: 10MB, 12000px per side,
  40,000,000 total decoded pixels, 300 frames, 30 seconds.** The byte cap is
  checked three times — the declared size when the upload URL is issued (only on
  the comment endpoint), the bytes that actually arrive, and in the browser
  before any transfer.
- **The pixel budget guards memory; it does not guard CPU.** Per-frame work is
  roughly linear in frame count and nearly independent of frame size, so an
  animation of thousands of 16x16 frames spends a rounding error of the pixel
  budget while asking the encoder for thousands of frames of work. The frame
  limit was 1000 until 2026-08-24, which was no limit at all for that shape of
  file. **Report CPU time as well as RSS** when measuring an animation — RSS is
  what the pixel budget already protects, so RSS alone cannot show the cost the
  frame limit exists for.
- **Duration is a separate axis from frame count.** 300 frames at one second each
  is five minutes of animation inside every other limit. It is enforced only when
  libvips reports a complete set of per-frame delays (`metadata.delay`, one per
  page, all finite); a partial array would understate the total, and understating
  it is how a limit gets bypassed. When the delays are unknowable the frame limit
  still applies — **never drop one in favour of the other**.
- **A header is not proof the picture exists.** `metadata()` reads a header and
  stops, so a file truncated to a third of its length still states a good
  640x480 and passes every size check — the record is written and the failure
  surfaces later as a row pointing at an image that was never produced.
  `assertDecodesCompletely` closes that with a **full decode**.

  The contract, stated once: **an image is accepted only if the processing
  pipeline can decode all of it. Anything irrecoverably corrupt or truncated is
  rejected. Recoverable warnings — the ones ordinary photographs carry — reject
  nothing.** There is no per-format exception.
- **The verification decode must agree with the pipeline, and a cheap probe does
  not.** `sharp(...).resize(32, 32).toBuffer()` looks like the obvious way to
  force a decode. It is wrong, and wrong in the worst direction: resizing a JPEG
  down lets libjpeg scale during the DCT, so it reads a fraction of the
  scanlines, never reaches the truncation and reports success — on a file that
  then throws `VipsJpeg: Premature end of input file` the moment
  `replaceWithoutExif` decodes it at full size. That is precisely the accepted
  record with no renderable image behind it. `.stats()` decodes every scanline,
  so its verdict is the pipeline's verdict. Measured at the very top of the
  comment budget (40MP): ~520ms wall, ~4.4s CPU across threads, and **no RSS
  growth**, because libvips streams it instead of materialising the 160MB raster.
  The harness asserts the agreement directly over eight fixtures rather than
  trusting it.
- **Do not reach for `failOn: 'warning'`.** It would refuse ordinary photographs:
  real files from phones and browsers routinely warn about extraneous bytes
  before a marker, trailing data after EOI, or a non-standard EXIF block, and
  every one decodes fine. The harness keeps four such fixtures precisely to fail
  if someone tightens this.
- **Decoder text never reaches the client.** "pngload: end of stream" is a fact
  about libvips, not advice for whoever picked the file. `fail()` takes a
  `reason` this service wrote (returned) and a `detail` from the decoder (logged
  only); a harness check greps four rejection bodies for decoder vocabulary.
- **Animation policy: preserved.** `ImageService.replaceWithoutExif` opens a GIF
  with `animated: true`, so the stored original keeps moving. That is why the
  budget counts every frame rather than measuring one and assuming the rest are
  free.
- **The client reads dimensions from the header, never by decoding.** Handing the
  bytes to an `Image` element or `createImageBitmap` asks the browser to
  rasterise the very file the limit exists to refuse.
  `readImageDimensions` parses PNG/GIF/WebP/JPEG headers directly, and
  `readIsoBmffDimensions` walks the AVIF/HEIC box tree down to `ispe` — those two
  are the formats whose size is not at a fixed offset, and until 2026-08-24 they
  were the ones that reached the dialog unmeasured. The walker is bounded against
  hostile input: zero-length and short boxes end the walk, a 64-bit size past a
  safe integer is refused, lengths are clamped to the buffer, and both nesting
  depth and total box count are capped.
  `readGifAnimation` walks a GIF's block stream to count frames and sum delays —
  the only way to know a GIF's frame count, since frames are simply appended —
  and stops as soon as the count passes the limit. It sums delays as stored,
  which can only under-report, and under-reporting is the right direction for a
  hint: it refuses only what is definitely over and leaves the rest to the server.
  This is what keeps an oversized pick from raising the *Replace the current
  image?* dialog about a file that was never going to be accepted.
- **The client sniffs the real header before uploading.** `describeInvalidImageContent`
  reads the first 32 bytes with `file.slice(...).arrayBuffer()`. This is what
  keeps an invalid pick from raising the *Replace the current image?* dialog
  about a file that was never going to be accepted, and from creating a record to
  clean up. A read that fails resolves to `null` — the browser could not answer,
  so the question goes to the server rather than blocking a file that may be fine.
- **Verify the image limits by running them, not by reading them.**
  `file-server` has no test runner, so the checks that need real Sharp/libvips
  live in a script instead of a `.spec` that nothing would execute:

  ```bash
  cd file-server && yarn build && yarn verify:policies
  ```

  It builds every fixture in an OS temp directory, removes it in a `finally`, and
  exits non-zero on the first failed assertion. It covers the codes and their
  statuses in both vocabularies, the frame and duration boundaries, a 4.6KB GIF
  that decodes to 50M pixels, CPU/RSS for a 5000-frame flood and for a worst-case
  40MP accepted still, the per-type regression matrix (comment refuses / post,
  message, avatar, cover accept the same fixtures), spoofed TUS metadata in both
  directions, the corruption contract including four ordinary-photograph fixtures
  that must not be refused, that the verification decode agrees with the
  pipeline, that no decoder text reaches a client, that accepted files re-encode
  and decode back, and that a rejected upload leaves no record, no bytes and no
  derivatives — driving the real `FileService.processTusUpload` against an
  in-memory model rather than a database.

  A rejection that carries no policy code is treated as the harness's own stub
  failing downstream, not as a refusal. Conflating the two made every accepted
  upload read as a rejection the first time the matrix ran. `scripts/generate-comment-image-fixtures.js` regenerates the web
  app's fixtures and refuses to emit one libvips reads differently.

  The pure-policy half runs in jest, in the apps that have a runner:
  `user/src/hooks/comment-image-validation.spec.ts`,
  `user/src/components/comment/comment-image-composer.spec.tsx`,
  `user/src/lib/upload-policy-contract.spec.ts` and
  `api/src/common/exceptions/comment/comment-image-contract.spec.ts`.
- **A GIF frame need not cover the canvas.** Each image descriptor states its own
  size, and the decoder composites it onto the logical screen — so 200 frames of
  1x1 on a 500x500 canvas is 4.6KB that decodes to 50 million pixels. That gap is
  what the pixel budget is for, and it is also the only practical way to build a
  fixture for it: a file that decodes to 50M pixels *and* covers its canvas would
  be larger than the 10MB byte limit, so it would test the wrong rule.
- **A comment needs text *or* an image, and every layer has to agree.** The
  payload rule (`CommentHasContentConstraint`) allowed image-only from the start
  while `comment-wrapper.tsx` still demanded text, so the picture uploaded and
  stored successfully and the comment was then refused as empty. When adding an
  alternative to a required field, grep every layer for the old requirement —
  a passing backend test proves nothing about the client's own gate.
- **Clear the composer only once the comment exists.** It used to reset and then
  post, which reads as optimistic but is not: a failed request left the author
  with an empty box and no way to retry, while their image sat uploaded and
  invisible. `onSubmit` resolving to `null` means "not created" and the draft
  survives.
- **Do not render an empty `<p>` for an image-only comment** — it still costs its
  line height and top margin, which reads as an accidental gap.

## Bundled Rules

Read only the relevant files under `rules/` for security, processing, frontend, performance, or error-handling details. Verify every referenced path against the current repository before applying an example.

## Verification

- Cover direct upload, resumable upload, invalid type/size, unauthorized attachment, interrupted upload, processing failure, and cleanup.
- **Test the limits at the boundary**: exactly on each limit, and exactly one
  pixel past it. An off-by-one here is the difference between refusing valid
  pictures and admitting bombs.
- **A hand-written GIF needs valid LZW.** libvips reads the frame count from the
  headers but fails the actual decode with `gifload: Invalid frame data` if the
  code table is never reset — so a fixture can look multi-frame to `metadata()`
  and be undecodable. Emit a Clear Code before each literal, then use that valid
  seed as *input to Sharp* to produce a properly compressed fixture: that is what
  makes an animated bomb small on disk and enormous decoded, like a real one.
- **Test invalid files with real encoded bytes**, not a `File` with a made-up
  name and MIME. The whole failure mode is that the claim and the content
  disagree, so a fixture built from claims passes while the hole stays open. Use
  a real MP4 from `file-server/public/videos/`, a real PDF header, a real SVG,
  and Sharp-encoded pictures for the accepted formats. In jsdom, `File.slice()`
  has no `arrayBuffer()` — shim it, or the byte check is silently skipped and the
  test stops covering it.
- Measure a rejection on **both** stores and on the counts: file record, bytes
  and derivatives on disk, comment count, notifications, socket events. "The
  response said no" is not the same as "nothing was left behind".
- Run verification for every touched app.
