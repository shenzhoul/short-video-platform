# API Rules

These rules apply to `api/` and to equivalent NestJS code in `file-server/`.

## Layering

- Keep controllers, listeners, gateways, and jobs limited to transport or scheduling concerns.
- Put business rules, database access, and orchestration in services.
- Enforce feature-specific authorization in services even when guards provide coarse authentication or role checks.
- Validate permissions and invariants before mutation.

## Naming And Routes

- Use lowercase kebab-case filenames and camelCase TypeScript members.
- Group controllers and services by the current domains: `community`, `content`, `identity`, and `system`.
- Align audience-specific controller names and route prefixes:
  - `admin-*.controller.ts` for `/admin/...`
  - `creator-*.controller.ts` for `/creator/...`
  - plain feature names for public or normal user routes
- Do not introduce domain folders for features that are not implemented.

## Payloads And DTOs

- Define payload classes for body, query, and structured path input.
- Extend `api/src/kernel/common/search-request.ts` for searchable and paginated endpoints.
- Keep normalization and `class-validator`/`class-transformer` behavior in payloads rather than controllers.
- Return DTOs from controller-facing services; do not expose Mongoose documents.
- Treat DTO mapping as the privacy boundary and use explicit public, private, or admin shapes when audiences differ.

## Errors And Translation

- Use the exception hierarchy under `api/src/common/exceptions/`.
- Return not-found errors for missing resources rather than leaking raw errors as HTTP 500 responses.
- Use `__t` from `api/src/utils/translation.ts` for user-facing API messages and keep locale keys synchronized.
- Validate ObjectId-only route parameters with the existing ObjectId parsing pattern.

## Data, Settings, And Migrations

- Keep migrations in `api/migrations/`; use the existing timestamped migration runner.
- Seed system settings through the existing settings migration/data files and expose them through `SettingService`.
- Add indexes for new recurring query patterns.
- Default optional numeric fields before using them in a counter delta. An absent field makes the delta `NaN`, and `$max: [0, NaN]` resolves to `0` — silently destroying the counter instead of failing. When a counter can already be wrong in stored data, ship a dry-run-by-default maintenance script under `api/scripts/` rather than recomputing on the read path.
- Paginate list endpoints and avoid queries inside loops.
- Never give an indexed optional field a `default: null`. Mongoose then persists
  the field on **every** document, and a `unique + sparse` index skips only
  documents where the field is *missing* — an explicit `null` is still indexed, so
  the second document written collides with the first. Leave the field with no
  default so it is omitted, and prefer a **partial** index
  (`partialFilterExpression: { field: { $type: 'string' } }`) over `sparse` when
  the constraint should apply to a subset. Do not combine the two.
- Changing an existing index's options is not something `autoIndex` can do:
  `createIndex` fails with a conflict against the old definition. Ship a repair
  script that drops and recreates it, and verify the runtime index matches the
  schema declaration rather than assuming boot reconciled them.
- Catch a duplicate-key error narrowly. `error.code === 11000` alone says nothing
  about *which* index; check `error.keyPattern.<field>` before treating a
  collision as an idempotent no-op, or an unrelated conflict gets reported as
  success.

## File Attachments

- A file reference on a domain document is attached **after** the owning row is
  written, never before. `refItems` empty is the draft state the unused-file
  sweeper collects, so referencing first turns a failed insert into an orphan
  nothing will reclaim.
- **That inverts when the row already exists.** Swapping a file pointer on a live
  row — an avatar, a cover — must reference the new file **first**. The rule
  underneath both is *never leave a published row pointing at an unreferenced
  file*: for a new row that means row first, for a pointer swap it means
  reference first, because the sweeper would otherwise delete an image the
  profile is already serving. See `BaseUserService.attachProfileImageReference`.
- **Check that the reference landed.** `updateFileOwnership` reports how many
  records it matched and always writes `updatedAt`, so `updated: 0` means the
  file does not exist — and never will carry a reference. Discarding that return
  publishes a row pointing at something the sweeper collects. Fail the request
  instead; keeping the previous file is recoverable, a broken row is not.
- **A grep for `addRef` does not prove a file is unreferenced.**
  `updateFileOwnership({ ref })` attaches one too and that search never sees it.
  Confirm with one aggregate over the `files` collection before filing or acting
  on a missing-reference claim.
- **Take the replaced id from the swap, never from a pre-read.** Repointing a
  document at a new file is one
  `findOneAndUpdate(..., { returnDocument: 'before' })`, and the old file is read
  out of *that* result. With a separate read first, two concurrent replacements
  both believe they displaced the original: both delete it, and the intermediate
  file is left **referenced** and therefore invisible to the sweeper — an orphan
  nothing can ever collect. Re-read the current pointers before deleting, too:
  one file can be referenced by two fields of the same document.
- **Compensate forward, not backward.** Without a shared transaction, order each
  step so its failure lands somewhere recoverable, and compensate only the steps
  before the document is correct. Once the row is written and published, a
  storage failure afterwards is never a reason to roll it back — drop the old
  file's reference so the sweeper finishes the job, and let the audit script
  catch the rest. Compensation must not throw: it runs while another failure is
  already being reported.
- **Detach on clear, not only on replace.** Anywhere a file pointer is set to
  null — account deletion, unsetting a cover — remove the reference too, or the
  file is stranded in the one state nothing collects.
- Re-check ownership, the durable upload `type`, and that the file is still
  unreferenced before attaching. Never trust request metadata for the type —
  image processing normalises it away — and never trust the client's word for
  who owns it.
- Reject a file whose processing failed. The record survives a failed decode, and
  attaching one produces a row pointing at an image that was never produced.
- A discard endpoint must be idempotent and must **refuse** to delete a file that
  has since been referenced: a cleanup request racing a successful create would
  otherwise strip the attachment from a published row.
- Register every new upload `type` in `cleanup-unused-files.job.ts`. Client-side
  cleanup is an optimisation; the sweeper is what makes a crashed browser or a
  dropped connection survivable.
- **Every durable upload type names its own policy, and there is no default.**
  `shared/upload-policy` is the registry (`getUploadPolicy(type)`), read by the
  API, the file server and the web client. Both possible defaults are wrong: one
  that means "the strictest policy in the system" quietly re-scopes every
  existing upload the first time a feature tightens, and one that means "no
  limits" is what left post photos, avatars, covers and every video unguarded
  for as long as it existed. A type with no policy is **refused**
  (`UNSUPPORTED_UPLOAD_TYPE`) — a typo like `post-phto` must never resolve to
  something wider than the type it misspells, and a forgotten registration must
  be a loud 400 rather than an unvalidated file on disk.
- **Never validate a video with an image validator.** They answer different
  questions: an audio file renamed `.mp4` is a *valid MP4*, and only counting the
  non-`attached_pic` video streams catches it. Video needs its own service, its
  own probe and its own codes — reusing `INVALID_IMAGE_FORMAT` for a video tells
  the client something untrue about what it sent.
- **A container that probes cleanly is not a video that exists.** A faststart MP4
  truncated to a third of its length reports a full duration and a healthy stream
  from its header; the failure only surfaces in the transcode, on a queue,
  minutes later. Decode a frame near the *end* (`-ss <duration-2s> -frames:v 1
  -xerror`), which costs an index seek rather than a full decode. Say plainly
  that it is not a full integrity proof.
- **Never whitelist a codec because `ffprobe` can read it.** MPEG-2 probes
  perfectly and is still refused: the bar is that the pipeline can transcode it
  and a browser can play the result.
- Resolve that policy from **server-written, durable data** — the `type` on the
  record the API created, not the metadata the uploader sent alongside the bytes.
  Client metadata selecting a policy means the client can opt out of a limit by
  relabelling, and can impose one on somebody else's upload type. Test both
  directions.
- Answer each tier in its own vocabulary. A rejection code scoped to one feature
  (`COMMENT_*`) must not be raised for an upload that has nothing to do with that
  feature; the client matching it is asking a narrower question than the one you
  are answering.
- One refusal, one code, and never one code for two different refusals. A file
  that is too many **bytes** and a file that is too many **pixels** are separate
  problems with separate advice: a 30000x30000 PNG can be 200KB, and a 600x400
  photograph can be 11MB. Give each its own stable code and its own status —
  413 belongs to the byte limit and nothing else — and let the client match on
  the code, never on the message text. See
  `.agents/skills/file-service-integration/SKILL.md` for the comment-image
  contract.
- Public limits that a client also enforces belong in a shared, dependency-free
  package (`shared/upload-policy`), not in a constant copied into each app. The
  server stays the authority — the client's copy is early feedback and is never
  a reason to skip a server check — but both must be reading the same number.
  Yarn v1 *copies* `file:` dependencies, so add a contract spec comparing the
  installed module against the repo source or the copies will drift silently.
- A pixel budget guards memory, not CPU. Per-frame work is roughly linear in
  frame count and nearly independent of frame size, so an animation of thousands
  of tiny frames passes every byte and pixel limit while spending real CPU. Bound
  frame count *and* playing time, and when you measure the cost report CPU time
  as well as RSS — RSS is exactly what the pixel budget already protects.
- `sharp().metadata()` reads a header and stops. A truncated file still states
  good dimensions and passes every size check, and the failure surfaces later as
  a row pointing at an image that was never produced. Force a full decode
  (`failOn: 'error'`, then `.stats()`) before accepting the file, and **assert
  that the check agrees with the processing pipeline**. A cheaper probe that
  resizes down does not: libjpeg scales during the DCT, reads a fraction of the
  scanlines, never reaches the truncation, and accepts a file the pipeline then
  refuses — which is exactly the unrenderable record the check was added to
  prevent. `.stats()` streams, so a 40-megapixel decode costs CPU and essentially
  no RSS.
- Never forward a decoder's error text to a client. Return wording the service
  wrote and log what the library said.
- **Bound expensive validation with a concurrency gate, not with hope.** A 60MP
  decode is seconds of CPU and an FFmpeg probe is a child process, and TUS
  completions arrive whenever transfers happen to finish — nothing in the request
  path bounds the fan-out on its own. Gate it, make the *wait* bounded too (a
  full gate should answer "busy" rather than parking a request forever), and
  release the slot in a `finally`: a rejection is the common case for a
  validator, so a limiter that leaks a slot per refusal seizes up after N bad
  files. Give every child process a timeout, SIGKILL it when it overruns, and cap
  how much of its output you keep in memory.
- **Never forward a probe's or decoder's error text to a client.** "moov atom not
  found" is a fact about a demuxer, not advice for whoever picked the file. Log
  what the library said; return wording the service wrote.
- Decide what an uploaded file **is** from its bytes, never from the extension,
  the declared MIME, or the `accept` attribute — every one of those is chosen by
  whoever uploads, and renaming `clip.mp4` to `clip.png` changes all of them at
  once. Bound the decoded size as well as the byte size, and apply that bound
  through the decoder (`limitInputPixels`) so an oversized image is refused when
  it is opened rather than after it is in memory. See
  `.agents/skills/file-service-integration/SKILL.md`.

## Boolean Query Parameters

`main.ts` installs the global pipe with
`transformOptions: { enableImplicitConversion: true }`. Class-transformer
therefore coerces every query string to the property's **reflected type before**
a custom `@Transform` runs — and for a boolean that coercion is
`Boolean(string)`, so `'false'` becomes `true`.

A `@Transform` that reads `value` cannot recover from this: it is handed the
already-converted `true` and has nothing left to distinguish the two. Read the
raw value from `obj` instead:

```ts
// WRONG — `value` has already been through Boolean('false') === true
@Transform(({ value }) => value === true || value === 'true')

// RIGHT — `obj` is the untouched source object
@Transform(({ obj }) => obj?.lastIsPinned === true || obj?.lastIsPinned === 'true')
```

This shipped. `lastIsPinned` on the creator-list cursor was **always true**
whenever the parameter was present, which sent every page down the "still inside
the pinned block" branch of `applyCreatorPinnedCursor` — whose second arm matches
every unpinned post with no `createdAt` bound. Each page returned the same rows
and `hasMore` never went false: paging a 10-post creator produced 32 rows
containing 6 distinct posts, and the client looped. Nothing errored.

Two habits that would have caught it:

- **Assert the parse, with implicit conversion switched on.** A payload test
  that calls `plainToInstance(..., { enableImplicitConversion: true })` sees what
  the controller sees; one without that option passes while production breaks.
- **Page a list to exhaustion in a test, and count distinct ids.** A cursor that
  never terminates looks identical to a cursor that works, one page at a time.

`src/payloads/content/post/creator-cursor.spec.ts` covers both.

## Cursor Dates Have Three Forms

`lastCreatedAt` is documented and validated as "ISO string, timestamp string, or
number". `parseDateFromCursor` in `src/common/utils/pagination.util.ts` handles
all three; a bare `new Date(value)` does not — `new Date('1788064858000')` is an
Invalid Date, which the driver refuses to serialise, so the endpoint answers
500. Every cursor code path must go through `parseDateFromCursor`, not
`new Date`.

## Queues And Sockets

- Put jobs under `api/src/jobs/<domain>/`.
- Use `QueueService` for workers, recurring jobs, and delayed work.
- Use `QueueMessageService` for distributed event fan-out.
- Use `SocketUserService` and the current socket gateway/provider flow for online presence and socket delivery.
- Load the corresponding queue, scheduled-job, or WebSocket skill before editing these flows.
- Load `.agents/skills/direct-messaging/SKILL.md` before touching conversation, message, messaging-permission, or block/restrict code.
- Load `.agents/skills/post-sharing/SKILL.md` before touching share endpoints, shared-post messages, or `totalShare`.
- `nest build` succeeding proves nothing about dependency injection. A provider that is exported but missing from the `appProviders` array compiles cleanly and then fails at boot with "Nest can't resolve dependencies". After adding a service, start the app once and confirm it reaches "Nest application successfully started".

## Verification

- `api/package.json` exposes Jest unit tests and build scripts; run `yarn test`, then `yarn build`.
- `file-server/package.json` exposes `lint` and `build` but no test script; run `yarn lint` and `yarn build`.
- Put focused unit tests beside the service under test with a `.spec.ts` suffix. Mock MongoDB, Redis, queues, and remote services at the unit boundary.
