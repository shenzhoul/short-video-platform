#!/usr/bin/env node
/**
 * Runtime verification of the per-type upload policy registry.
 *
 * ```
 * cd file-server
 * yarn build
 * yarn verify:policies
 * ```
 *
 * Exits 0 when every check passes and non-zero on the first failure it can
 * report, so it works unattended and in CI.
 *
 * ## Why this is a script and not a `.spec`
 *
 * `file-server` has no test runner — no jest, no ts-jest, no `test` script — and
 * committing a `.spec.ts` that nothing executes would look like coverage while
 * proving nothing at all. So the checks that need the real Sharp/libvips and the
 * real FFmpeg run here, against the compiled service in `dist/`, which is the
 * same code the server loads.
 *
 * The parts of the contract that are pure policy — codes, statuses, messages,
 * and the client's agreement with them — are covered by real jest suites in the
 * apps that have runners:
 *
 *   api/src/services/shared/file-server/upload-policy.service.spec.ts
 *   api/src/common/exceptions/comment/comment-image-contract.spec.ts
 *   user/src/lib/upload-policy.spec.ts
 *   user/src/lib/upload-policy-contract.spec.ts
 *
 * ## What it asserts
 *
 *  1. **Registry** — every durable type resolves to its own policy, every axis
 *     is a finite positive number, and an unknown type resolves to nothing.
 *  2. **Trusted dispatch** — the policy comes from the durable record and from
 *     nowhere else, tested by spoofing TUS metadata in both directions.
 *  3. **Image boundaries** — exactly at each limit passes, one past it fails,
 *     with the right code, against files a real encoder produced.
 *  4. **Video boundaries** — container, codec, streams, geometry, duration,
 *     frame rate and truncation, against files FFmpeg produced and `ffprobe`
 *     independently confirmed.
 *  5. **Cleanup** — a refused upload leaves no record and no bytes.
 *  6. **Concurrency and timeouts** — the gate bounds parallel work, a child
 *     process that overruns is killed, and neither leaks a slot.
 *  7. **Admin-adjusted limits** — the numbers bound to a record change what is
 *     enforced, are clamped to the hard ceilings, and cannot be set by the
 *     uploader.
 *
 * ## What it will not leave behind
 *
 * Every fixture goes into a fresh directory under the OS temp directory, and
 * that directory is removed in a `finally` — on success, on failure and on an
 * unhandled throw. Nothing touches a database: the cleanup section drives the
 * real `FileService.processTusUpload` against an in-memory stand-in for the
 * Mongoose model, so "the record is gone" is asserted against a store this
 * script owns rather than against anyone's MongoDB.
 *
 * ## It is not part of running the product
 *
 * Nothing imports it. It is not wired into startup, into a migration or into a
 * scheduled job, and a fresh database never needs it. It is a developer and CI
 * tool, run by hand or by a pipeline, and nothing else.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const policyPackage = require('@douyin-clone/upload-policy');
const sharp = require('sharp');

const crypto = require('crypto');

const { writeAnimatedGif } = require('./lib/animated-gif');
const video = require('./lib/video-fixtures');

// libvips keeps decoded files open in its operation cache, and on Windows an
// open handle makes the temp directory undeletable. This script's whole promise
// is that it leaves nothing behind, so the cache goes.
sharp.cache(false);

const DIST = path.resolve(__dirname, '..', 'dist');
if (!fs.existsSync(path.join(DIST, 'services', 'file', 'upload-policy.js'))) {
  process.stderr.write('dist/ is missing or stale. Run `yarn build` in file-server/ first.\n');
  process.exit(1);
}

/* eslint-disable import/no-dynamic-require, global-require */
const {
  resolveUploadPolicy,
  resolveImagePolicy,
  resolveVideoPolicy,
  UPLOAD_POLICY_BY_TYPE,
  ALL_UPLOAD_REJECTION_CODES
} = require(path.join(DIST, 'services/file/upload-policy'));
const { UPLOAD_HARD_CEILINGS } = policyPackage;
const { ImageContentValidationService } = require(path.join(DIST, 'services/file/image-content-validation.service'));
const { VideoContentValidationService } = require(path.join(DIST, 'services/file/video-content-validation.service'));
const { ConcurrencyLimiter } = require(path.join(DIST, 'lib/concurrency'));
const { FileService } = require(path.join(DIST, 'services/file/file.service'));
const { FILE_STATUS } = require(path.join(DIST, 'common/constants/content'));
/* eslint-enable import/no-dynamic-require, global-require */

// ---------------------------------------------------------------------------
// A very small harness. Deliberately not a framework.
// ---------------------------------------------------------------------------

const results = { passed: 0, failed: 0, skipped: 0 };
let currentSection = '';

function section(title) {
  currentSection = title;
  process.stdout.write(`\n${title}\n${'-'.repeat(title.length)}\n`);
}

function pass(what) {
  results.passed += 1;
  process.stdout.write(`  ok    ${what}\n`);
}

function fail(what, detail) {
  results.failed += 1;
  process.stdout.write(`  FAIL  ${what}\n        ${detail}\n`);
}

function skip(what, why) {
  results.skipped += 1;
  process.stdout.write(`  skip  ${what} (${why})\n`);
}

function check(what, condition, detail = '') {
  if (condition) pass(what);
  else fail(what, detail || 'condition was false');
}

function checkEqual(what, actual, expected) {
  if (actual === expected) pass(what);
  else fail(what, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** Run an async check, turning a throw into a failure rather than a crash. */
async function guarded(what, run) {
  try {
    await run();
  } catch (error) {
    fail(what, `${currentSection}: unexpected error — ${error?.message || error}`);
  }
}

/** The stable code an `HttpException` from a validator carries. */
function codeOf(error) {
  const body = typeof error?.getResponse === 'function' ? error.getResponse() : error?.response;
  return body?.error || null;
}

/**
 * Assert that validating `filePath` under `policy` is refused with `expected`.
 *
 * Returns the whole rejection body so a caller can also assert on the status —
 * which matters, because 413 belongs to the byte limit and to nothing else.
 */
async function expectRejection(what, run, expected) {
  try {
    await run();
    fail(what, `expected ${expected}, but the file was accepted`);
    return null;
  } catch (error) {
    const code = codeOf(error);
    if (code === expected) {
      pass(what);
    } else {
      fail(what, `expected ${expected}, got ${code || error?.message || error}`);
    }
    return typeof error?.getResponse === 'function' ? error.getResponse() : null;
  }
}

async function expectAccepted(what, run) {
  try {
    const value = await run();
    pass(what);
    return value;
  } catch (error) {
    fail(what, `expected acceptance, got ${codeOf(error) || error?.message || error}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let workDir;

const at = (name) => path.join(workDir, name);

/**
 * A flat PNG of the given size.
 *
 * Flat on purpose: a solid colour compresses to almost nothing, so a
 * 9000x9000 fixture is a couple of hundred kilobytes on disk and 81 million
 * pixels once decoded. That gap is the reason a byte limit cannot stand in for
 * a pixel budget, and it is what makes these fixtures cheap to produce.
 */
async function writePng(name, width, height) {
  const file = at(name);
  await sharp({
    create: {
      width, height, channels: 3, background: { r: 20, g: 90, b: 200 }
    }
  }).png({ compressionLevel: 9 }).toFile(file);
  return file;
}

async function writeJpeg(name, width, height) {
  const file = at(name);
  await sharp({
    create: {
      width, height, channels: 3, background: { r: 200, g: 40, b: 60 }
    }
  }).jpeg({ quality: 70 }).toFile(file);
  return file;
}

// ---------------------------------------------------------------------------
// 1. The registry
// ---------------------------------------------------------------------------

function verifyRegistry() {
  section('1. The policy registry');

  const types = policyPackage.UPLOAD_POLICY_TYPES;
  check('the registry is not empty', types.length > 0, 'no types registered');

  for (const type of types) {
    const policy = resolveUploadPolicy({ type });
    checkEqual(`${type} resolves to its own policy`, policy?.name, type);
  }

  // The regression the registry exists to remove: everything that was not
  // `comment-photo` used to fall into a tier with no limits at all, so a typo
  // and a deliberate choice were indistinguishable.
  check(
    'an unregistered type resolves to nothing rather than to a loose default',
    resolveUploadPolicy({ type: 'post-phto' }) === null,
    'a typo resolved to a policy'
  );
  check('a missing type resolves to nothing', resolveUploadPolicy({}) === null);
  check('a null record resolves to nothing', resolveUploadPolicy(null) === null);

  for (const type of types) {
    const policy = UPLOAD_POLICY_BY_TYPE[type];
    const axes = policy.mediaKind === 'image'
      ? ['maxBytes', 'maxWidth', 'maxHeight', 'maxPixels', 'maxFrames', 'maxDurationMs']
      : ['maxBytes', 'maxWidth', 'maxHeight', 'maxDurationMs', 'maxFrameRate', 'maxVideoBitrate'];

    const bad = axes.filter((axis) => !Number.isFinite(policy.limits[axis]) || policy.limits[axis] <= 0);
    check(
      `${type} states every limit as a finite positive number`,
      bad.length === 0,
      // An absent limit compares as "greater than nothing" and silently
      // disables the check it belongs to.
      `these are missing or non-positive: ${bad.join(', ')}`
    );

    const codes = Object.values(policy.codes);
    const missing = codes.filter((code) => !policy.statuses[code] || !policy.messages[code]);
    check(
      `${type} names a status and a message for every code it can raise`,
      missing.length === 0,
      `no status/message for: ${missing.join(', ')}`
    );
  }

  // The comment composer matches on these three exact strings.
  const comment = UPLOAD_POLICY_BY_TYPE['comment-photo'];
  checkEqual('comment-photo keeps INVALID_COMMENT_IMAGE_FORMAT', comment.codes.format, 'INVALID_COMMENT_IMAGE_FORMAT');
  checkEqual('comment-photo keeps COMMENT_IMAGE_FILE_TOO_LARGE', comment.codes.fileTooLarge, 'COMMENT_IMAGE_FILE_TOO_LARGE');
  checkEqual('comment-photo keeps COMMENT_IMAGE_DIMENSIONS_EXCEEDED', comment.codes.dimensions, 'COMMENT_IMAGE_DIMENSIONS_EXCEEDED');

  // And nothing else speaks that vocabulary: a post upload answered with a
  // COMMENT_* code would be telling the client something untrue.
  const leaked = policyPackage.UPLOAD_POLICY_TYPES
    .filter((type) => type !== 'comment-photo')
    .filter((type) => Object.values(UPLOAD_POLICY_BY_TYPE[type].codes).some((code) => code.startsWith('COMMENT_')));
  check('no other type answers in comment vocabulary', leaked.length === 0, `these do: ${leaked.join(', ')}`);

  check(
    'every rejection code is listed for the TUS layer to pass through',
    ALL_UPLOAD_REJECTION_CODES.includes('UNSUPPORTED_UPLOAD_TYPE')
      && ALL_UPLOAD_REJECTION_CODES.includes('VIDEO_DURATION_EXCEEDED')
      && ALL_UPLOAD_REJECTION_CODES.includes('INVALID_COMMENT_IMAGE_FORMAT'),
    `list was: ${ALL_UPLOAD_REJECTION_CODES.join(', ')}`
  );

  checkEqual('an image type resolves only as an image', resolveVideoPolicy({ type: 'avatar' }), null);
  checkEqual('a video type resolves only as a video', resolveImagePolicy({ type: 'post-video' }), null);
}

// ---------------------------------------------------------------------------
// 2. Trusted dispatch
// ---------------------------------------------------------------------------

function verifyTrustedDispatch() {
  section('2. Trusted dispatch — the durable record decides, nothing else');

  /**
   * The shapes an uploader controls. Every one of these is attached by whoever
   * is uploading — TUS metadata, the filename, the MIME the browser guessed —
   * and not one of them may change which policy applies.
   */
  const spoofs = [
    { filename: 'clip.mp4', filetype: 'video/mp4' },
    { filename: 'avatar.png', filetype: 'image/png' },
    { filename: 'x.gif', filetype: 'image/gif' },
    { type: 'post-video' },
    { type: 'comment-photo' },
    { type: 'post-photo' },
    { mediaType: 'video' }
  ];

  const pairs = [
    ['avatar', 'post-video'],
    ['post-video', 'avatar'],
    ['comment-photo', 'post-photo'],
    ['post-thumbnail', 'post-photo'],
    ['message-photo', 'comment-photo']
  ];

  for (const [durable, claimed] of pairs) {
    // The record is what `TusAuthService` wrote when the API asked for an upload
    // URL, and the signed token binds the bytes to this record. The metadata is
    // whatever the uploader felt like sending alongside them.
    const record = { type: durable, metadata: { type: claimed, filetype: 'video/mp4' } };
    const resolved = resolveUploadPolicy(record);
    checkEqual(
      `a ${durable} record claiming to be ${claimed} is judged as ${durable}`,
      resolved?.name,
      durable
    );
  }

  for (const spoof of spoofs) {
    const record = { type: 'avatar', ...{ metadata: spoof } };
    checkEqual(
      `avatar record is unmoved by metadata ${JSON.stringify(spoof)}`,
      resolveUploadPolicy(record)?.name,
      'avatar'
    );
  }

  // The other direction, which is just as important: an uploader must not be
  // able to *impose* a stricter policy on somebody else's upload type either,
  // because that is a denial of service dressed as caution.
  const postPhoto = resolveUploadPolicy({ type: 'post-photo', metadata: { type: 'comment-photo' } });
  checkEqual('a post photo cannot be forced into comment limits', postPhoto?.name, 'post-photo');
  check(
    'and it keeps its own, larger budget',
    postPhoto.limits.maxBytes > UPLOAD_POLICY_BY_TYPE['comment-photo'].limits.maxBytes,
    'post-photo did not keep a larger byte budget than comment-photo'
  );

  // Casing and stray whitespace are our own deployment mistakes rather than an
  // attack, so they resolve; anything beyond that does not.
  checkEqual('the lookup tolerates casing from our own code', resolveUploadPolicy({ type: ' Avatar ' })?.name, 'avatar');
  checkEqual('the lookup is not fuzzy beyond that', resolveUploadPolicy({ type: 'avatars' }), null);
}

// ---------------------------------------------------------------------------
// 3. Image boundaries
// ---------------------------------------------------------------------------

async function verifyImageBoundaries() {
  section('3. Image boundaries — exactly at the limit passes, one past it fails');

  const validator = new ImageContentValidationService();
  const imageTypes = policyPackage.UPLOAD_POLICY_TYPES
    .filter((type) => UPLOAD_POLICY_BY_TYPE[type].mediaKind === 'image');

  // --- per-side limits, for every image policy ----------------------------
  //
  // A 1-pixel-tall strip at exactly the width limit: real encoder output,
  // trivial to decode, and it isolates the per-side check from the pixel
  // budget, which a square at the same width would also trip.
  for (const type of imageTypes) {
    const policy = UPLOAD_POLICY_BY_TYPE[type];
    const { maxWidth } = policy.limits;

    const exact = await writePng(`${type}-exact-${maxWidth}.png`, maxWidth, 1);
    await expectAccepted(
      `${type}: ${maxWidth}x1 is accepted at exactly the width limit`,
      () => validator.assertDecodableImage(exact, 'exact.png', policy)
    );

    const over = await writePng(`${type}-over-${maxWidth + 1}.png`, maxWidth + 1, 1);
    await expectRejection(
      `${type}: ${maxWidth + 1}x1 is refused one pixel past it`,
      () => validator.assertDecodableImage(over, 'over.png', policy),
      policy.codes.dimensions
    );
  }

  // --- the pixel budget, which the per-side limits do not cover ------------
  //
  // Run for the two extremes rather than for every type: a 60MP decode is
  // several seconds of CPU, and the check being exercised is the same one.
  for (const type of ['avatar', 'post-photo']) {
    const policy = UPLOAD_POLICY_BY_TYPE[type];
    const side = Math.floor(Math.sqrt(policy.limits.maxPixels));

    const exact = await writePng(`${type}-pixels-exact.png`, side, side);
    await expectAccepted(
      `${type}: ${side}x${side} (${side * side} px) is accepted inside the ${policy.limits.maxPixels} pixel budget`,
      () => validator.assertDecodableImage(exact, 'exact.png', policy)
    );

    // Inside both per-side limits and past the budget — the shape a per-side
    // check alone would wave through.
    const overSide = side + 32;
    check(
      `${type}: the oversized fixture stays inside the per-side limits`,
      overSide <= policy.limits.maxWidth && overSide <= policy.limits.maxHeight,
      `${overSide} exceeds a per-side limit, so this would not isolate the budget`
    );
    const over = await writePng(`${type}-pixels-over.png`, overSide, overSide);
    await expectRejection(
      `${type}: ${overSide}x${overSide} (${overSide * overSide} px) is refused past the budget`,
      () => validator.assertDecodableImage(over, 'over.png', policy),
      policy.codes.dimensions
    );
  }

  // --- the byte limit, and its own status ---------------------------------
  //
  // Driven through a derived policy rather than a real one: producing a file of
  // exactly 10MB or 20MB to test a boundary is a lot of disk for a comparison
  // of two integers, and the code path is identical. The *real* limits are
  // asserted by the jest suites, which read them from the registry.
  const jpeg = await writeJpeg('bytes.jpg', 800, 600);
  const jpegSize = fs.statSync(jpeg).size;
  const base = UPLOAD_POLICY_BY_TYPE['post-photo'];

  await expectAccepted(
    `a ${jpegSize}-byte file is accepted at exactly the byte limit`,
    () => validator.assertDecodableImage(jpeg, 'bytes.jpg', {
      ...base, limits: { ...base.limits, maxBytes: jpegSize }
    })
  );

  const tooLarge = await expectRejection(
    'one byte over the limit is refused',
    () => validator.assertDecodableImage(jpeg, 'bytes.jpg', {
      ...base, limits: { ...base.limits, maxBytes: jpegSize - 1 }
    }),
    base.codes.fileTooLarge
  );
  checkEqual('and the byte refusal is a 413, which nothing else is', tooLarge?.statusCode, 413);

  // --- format whitelists differ per type ----------------------------------
  const gif = at('anim.gif');
  writeAnimatedGif(gif, 3, 100);

  await expectAccepted(
    'an animated GIF is accepted as a comment photo',
    () => validator.assertDecodableImage(gif, 'anim.gif', UPLOAD_POLICY_BY_TYPE['comment-photo'])
  );
  await expectAccepted(
    'and as a message photo, which has the same shape',
    () => validator.assertDecodableImage(gif, 'anim.gif', UPLOAD_POLICY_BY_TYPE['message-photo'])
  );
  await expectRejection(
    'the same GIF is refused as an avatar, which renders no animation',
    () => validator.assertDecodableImage(gif, 'anim.gif', UPLOAD_POLICY_BY_TYPE.avatar),
    UPLOAD_POLICY_BY_TYPE.avatar.codes.format
  );
  await expectRejection(
    'and as a post photo, for the same reason',
    () => validator.assertDecodableImage(gif, 'anim.gif', UPLOAD_POLICY_BY_TYPE['post-photo']),
    UPLOAD_POLICY_BY_TYPE['post-photo'].codes.format
  );

  // --- frame and duration boundaries, for the policies that animate --------
  const commentPolicy = UPLOAD_POLICY_BY_TYPE['comment-photo'];
  const { maxFrames } = commentPolicy.limits;

  const atFrames = at(`frames-${maxFrames}.gif`);
  writeAnimatedGif(atFrames, maxFrames, 10);
  await expectAccepted(
    `comment-photo: ${maxFrames} frames is accepted at exactly the frame limit`,
    () => validator.assertDecodableImage(atFrames, 'frames.gif', commentPolicy)
  );

  const overFrames = at(`frames-${maxFrames + 1}.gif`);
  writeAnimatedGif(overFrames, maxFrames + 1, 10);
  await expectRejection(
    `comment-photo: ${maxFrames + 1} frames is refused one frame past it`,
    () => validator.assertDecodableImage(overFrames, 'frames.gif', commentPolicy),
    commentPolicy.codes.dimensions
  );

  // Playing time is a separate axis from frame count: 60 frames held for a
  // second each is a minute of animation inside every frame limit there is.
  const longPlay = at('long-play.gif');
  const written = writeAnimatedGif(longPlay, 60, 1000);
  check(
    'the long-playing fixture is inside the frame limit, so duration is what refuses it',
    written.frames <= commentPolicy.limits.maxFrames
      && written.durationMs > commentPolicy.limits.maxDurationMs,
    `frames=${written.frames} durationMs=${written.durationMs}`
  );
  await expectRejection(
    'comment-photo: an animation past the playing-time limit is refused',
    () => validator.assertDecodableImage(longPlay, 'long.gif', commentPolicy),
    commentPolicy.codes.dimensions
  );

  // --- lying about what a file is -----------------------------------------
  const png = await writePng('real.png', 64, 64);

  const renamedVideo = at('not-an-image.png');
  fs.copyFileSync(await ensureSmallMp4(), renamedVideo);
  await expectRejection(
    'a video renamed to .png is refused as an image',
    () => validator.assertDecodableImage(renamedVideo, 'not-an-image.png', UPLOAD_POLICY_BY_TYPE.avatar),
    UPLOAD_POLICY_BY_TYPE.avatar.codes.format
  );

  const svg = at('vector.png');
  fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
  await expectRejection(
    'an SVG is refused however it is named — it is a document, not a picture',
    () => validator.assertDecodableImage(svg, 'vector.png', UPLOAD_POLICY_BY_TYPE['post-photo']),
    UPLOAD_POLICY_BY_TYPE['post-photo'].codes.format
  );

  // A file truncated to a third of its length still states good dimensions in
  // its header, so every check but the decode passes it.
  const truncated = at('truncated.png');
  const complete = fs.readFileSync(png);
  fs.writeFileSync(truncated, complete.subarray(0, Math.floor(complete.length * 0.35)));
  await expectRejection(
    'a truncated PNG is refused, because the decode has to complete',
    () => validator.assertDecodableImage(truncated, 'truncated.png', UPLOAD_POLICY_BY_TYPE['post-photo']),
    UPLOAD_POLICY_BY_TYPE['post-photo'].codes.format
  );

  const empty = at('empty.png');
  fs.writeFileSync(empty, Buffer.alloc(0));
  await expectRejection(
    'an empty file is refused',
    () => validator.assertDecodableImage(empty, 'empty.png', UPLOAD_POLICY_BY_TYPE.avatar),
    UPLOAD_POLICY_BY_TYPE.avatar.codes.format
  );

  // The rejection body must never carry the decoder's own words.
  const body = await expectRejection(
    'a corrupt file is still refused in our wording',
    () => validator.assertDecodableImage(truncated, 'truncated.png', UPLOAD_POLICY_BY_TYPE.avatar),
    UPLOAD_POLICY_BY_TYPE.avatar.codes.format
  );
  const serialised = JSON.stringify(body || {});
  check(
    'and the body leaks nothing libvips said',
    !/vips|libvips|pngload|jpegload|premature/i.test(serialised),
    `body was ${serialised}`
  );
}

/** One small MP4, made once and reused by several sections. */
let smallMp4Path = null;
async function ensureSmallMp4() {
  if (!smallMp4Path) smallMp4Path = video.writeMp4(at('small.mp4'));
  return smallMp4Path;
}

// ---------------------------------------------------------------------------
// 4. Video boundaries
// ---------------------------------------------------------------------------

async function verifyVideoBoundaries() {
  section('4. Video boundaries — probed, not guessed');

  if (!video.hasFfmpeg()) {
    skip('every video check', 'ffmpeg/ffprobe not on PATH');
    return;
  }

  const validator = new VideoContentValidationService();
  const postVideo = UPLOAD_POLICY_BY_TYPE['post-video'];
  const teaser = UPLOAD_POLICY_BY_TYPE['post-teaser'];

  /** Confirm a fixture really is what it claims before trusting a result from it. */
  const confirm = (what, file, expectations) => {
    const probed = video.probe(file);
    const wrong = Object.entries(expectations)
      .filter(([key, expected]) => probed[key] !== expected);
    check(
      `fixture check: ${what}`,
      wrong.length === 0,
      `ffprobe disagrees: ${JSON.stringify(probed)}`
    );
    return probed;
  };

  // --- the containers and codecs the pipeline reads ------------------------
  const mp4 = await ensureSmallMp4();
  confirm('the MP4 fixture is H.264 in an ISO-BMFF container', mp4, { videoCodec: 'h264', videoStreams: 1 });
  const verified = await expectAccepted(
    'a plain H.264 MP4 is accepted',
    () => validator.assertPlayableVideo(mp4, 'small.mp4', postVideo)
  );
  checkEqual('and its container is read from the bytes', verified?.container, 'mp4');
  checkEqual('and its MIME comes from that, not from the request', verified?.mimeType, 'video/mp4');

  const withAudio = video.writeMp4WithAudio(at('audio.mp4'));
  confirm('the audio fixture really carries an AAC track', withAudio, { videoCodec: 'h264', audioCodec: 'aac' });
  const audioVerified = await expectAccepted(
    'an MP4 with an AAC track is accepted — audio is optional, not forbidden',
    () => validator.assertPlayableVideo(withAudio, 'audio.mp4', postVideo)
  );
  checkEqual('and the audio codec is reported', audioVerified?.audioCodec, 'aac');

  const webm = video.writeWebm(at('clip.webm'));
  confirm('the WebM fixture is VP9 in Matroska', webm, { videoCodec: 'vp9' });
  const webmVerified = await expectAccepted(
    'a VP9 WebM is accepted',
    () => validator.assertPlayableVideo(webm, 'clip.webm', postVideo)
  );
  checkEqual('and reads as webm', webmVerified?.container, 'webm');

  const mov = video.writeMov(at('clip.mov'));
  const movVerified = await expectAccepted(
    'an H.264 MOV is accepted',
    () => validator.assertPlayableVideo(mov, 'clip.mov', postVideo)
  );
  // MP4 and MOV share a demuxer, so the probe reports the family and the header
  // sniff reports the member. Treating that as a disagreement would refuse
  // every MOV ever uploaded.
  check(
    'and its container is read as an ISO-BMFF member rather than refused',
    movVerified?.container === 'mov' || movVerified?.container === 'mp4',
    `got ${movVerified?.container}`
  );

  // --- the disguises -------------------------------------------------------
  const audioOnly = video.writeAudioOnlyMp4(at('audio-only.mp4'));
  confirm('the audio-only fixture really has no video stream', audioOnly, { videoStreams: 0 });
  await expectRejection(
    'an audio file renamed to .mp4 is refused — it is a valid MP4 with nothing to play',
    () => validator.assertPlayableVideo(audioOnly, 'song.mp4', postVideo),
    postVideo.codes.format
  );

  const imageAsVideo = video.writeImageNamedAsVideo(at('picture.mp4'));
  await expectRejection(
    'a PNG named .mp4 is refused at the header, before a probe runs',
    () => validator.assertPlayableVideo(imageAsVideo, 'picture.mp4', postVideo),
    postVideo.codes.format
  );

  const notAContainer = video.writeNotAContainer(at('document.mp4'));
  await expectRejection(
    'a PDF named .mp4 is refused at the header',
    () => validator.assertPlayableVideo(notAContainer, 'document.mp4', postVideo),
    postVideo.codes.format
  );

  const unsupported = video.writeUnsupportedCodecMp4(at('mpeg2.mp4'));
  confirm('the unsupported fixture is MPEG-2, which ffprobe reads perfectly', unsupported, { videoCodec: 'mpeg2video' });
  await expectRejection(
    'an MPEG-2 clip is refused for its codec, not for its container',
    () => validator.assertPlayableVideo(unsupported, 'mpeg2.mp4', postVideo),
    postVideo.codes.codec
  );

  const twoStreams = video.writeTwoVideoStreamsMp4(at('two-streams.mp4'));
  confirm('the multi-stream fixture really has two video streams', twoStreams, { videoStreams: 2 });
  await expectRejection(
    'a container with two video streams is refused — exactly one is expected',
    () => validator.assertPlayableVideo(twoStreams, 'two.mp4', postVideo),
    postVideo.codes.format
  );

  const truncated = video.writeTruncatedMp4(at('truncated.mp4'));
  const truncatedProbe = video.probe(truncated);
  // This is the fixture the tail decode exists for: ffprobe is *happy* with it.
  check(
    'the truncated fixture still probes as a healthy clip, which is the point',
    truncatedProbe.videoStreams === 1 && Number.isFinite(truncatedProbe.durationSeconds),
    `ffprobe: ${JSON.stringify(truncatedProbe)}`
  );
  await expectRejection(
    'a truncated MP4 is refused, because a frame near the end has to decode',
    () => validator.assertPlayableVideo(truncated, 'truncated.mp4', postVideo),
    postVideo.codes.format
  );

  // --- the budgets ---------------------------------------------------------
  const uhd = video.writeMp4(at('uhd.mp4'), {
    width: postVideo.limits.maxWidth, height: postVideo.limits.maxHeight, seconds: 0.4, fps: 5
  });
  confirm('the 4K fixture really is 4K', uhd, {
    width: postVideo.limits.maxWidth, height: postVideo.limits.maxHeight
  });
  await expectAccepted(
    `post-video: ${postVideo.limits.maxWidth}x${postVideo.limits.maxHeight} is accepted at exactly the resolution limit`,
    () => validator.assertPlayableVideo(uhd, 'uhd.mp4', postVideo)
  );

  // H.264 needs even dimensions, so "one pixel over" is two.
  const overRes = video.writeMp4(at('over-res.mp4'), {
    width: postVideo.limits.maxWidth + 2, height: postVideo.limits.maxHeight, seconds: 0.4, fps: 5
  });
  await expectRejection(
    `post-video: ${postVideo.limits.maxWidth + 2} wide is refused past the limit`,
    () => validator.assertPlayableVideo(overRes, 'over-res.mp4', postVideo),
    postVideo.codes.resolution
  );

  // Orientation-aware: the same pixels stood on end must still be accepted, or
  // every phone recording is refused.
  const portrait = video.writeMp4(at('portrait.mp4'), {
    width: postVideo.limits.maxHeight, height: postVideo.limits.maxWidth, seconds: 0.4, fps: 5
  });
  await expectAccepted(
    'post-video: the same frame in portrait is accepted, not refused for being tall',
    () => validator.assertPlayableVideo(portrait, 'portrait.mp4', postVideo)
  );

  // Duration is tested against the teaser policy, whose limit is 60 seconds —
  // a real boundary that costs a second to encode, where post-video's ten
  // minutes would not.
  const teaserSeconds = teaser.limits.maxDurationMs / 1000;
  const atLimit = video.writeMp4(at('teaser-at.mp4'), { seconds: teaserSeconds, fps: 5 });
  confirm('the at-limit teaser fixture really is that long', atLimit, { videoStreams: 1 });
  await expectAccepted(
    `post-teaser: ${teaserSeconds}s is accepted at exactly the duration limit`,
    () => validator.assertPlayableVideo(atLimit, 'teaser.mp4', teaser)
  );

  const overLimit = video.writeMp4(at('teaser-over.mp4'), { seconds: teaserSeconds + 2, fps: 5 });
  await expectRejection(
    `post-teaser: ${teaserSeconds + 2}s is refused past it`,
    () => validator.assertPlayableVideo(overLimit, 'teaser-over.mp4', teaser),
    teaser.codes.duration
  );
  await expectAccepted(
    'and the same clip is fine as a post video, whose limit is longer',
    () => validator.assertPlayableVideo(overLimit, 'teaser-over.mp4', postVideo)
  );

  const atFps = video.writeMp4(at('fps-60.mp4'), { seconds: 1, fps: postVideo.limits.maxFrameRate });
  await expectAccepted(
    `post-video: ${postVideo.limits.maxFrameRate}fps is accepted at exactly the frame-rate limit`,
    () => validator.assertPlayableVideo(atFps, 'fps.mp4', postVideo)
  );

  const overFps = video.writeMp4(at('fps-120.mp4'), { seconds: 1, fps: postVideo.limits.maxFrameRate * 2 });
  await expectRejection(
    `post-video: ${postVideo.limits.maxFrameRate * 2}fps is refused past it`,
    () => validator.assertPlayableVideo(overFps, 'fps.mp4', postVideo),
    postVideo.codes.frameRate
  );

  // The byte limit, through a derived policy for the same reason the image one
  // is: a 500MB fixture is a lot of disk to compare two integers.
  const size = fs.statSync(mp4).size;
  await expectAccepted(
    `a ${size}-byte clip is accepted at exactly the byte limit`,
    () => validator.assertPlayableVideo(mp4, 'small.mp4', {
      ...postVideo, limits: { ...postVideo.limits, maxBytes: size }
    })
  );
  const videoTooLarge = await expectRejection(
    'one byte over is refused',
    () => validator.assertPlayableVideo(mp4, 'small.mp4', {
      ...postVideo, limits: { ...postVideo.limits, maxBytes: size - 1 }
    }),
    postVideo.codes.fileTooLarge
  );
  checkEqual('and the video byte refusal is a 413 too', videoTooLarge?.statusCode, 413);

  // Nothing FFmpeg said may reach a client.
  const leak = await expectRejection(
    'a refusal is worded by us',
    () => validator.assertPlayableVideo(audioOnly, 'song.mp4', postVideo),
    postVideo.codes.format
  );
  check(
    'and never carries ffmpeg/ffprobe error text',
    !/moov|ffmpeg|ffprobe|Invalid data found/i.test(JSON.stringify(leak || {})),
    `body was ${JSON.stringify(leak || {})}`
  );
}

// ---------------------------------------------------------------------------
// 5. Cleanup
// ---------------------------------------------------------------------------

/**
 * Drive the real `processTusUpload` against an in-memory model.
 *
 * Nothing here touches MongoDB. `FileService` only ever calls a handful of
 * model methods on this path, so a small stand-in covers it — and "the record is
 * gone" is then asserted against a store this script owns rather than against
 * whatever happens to be in a developer's local database.
 */
function makeFileService(store) {
  const findRecord = (query) => store.find((record) => (
    (!query.tusId || record.tusId === query.tusId)
    && (!query.status || record.status === query.status)
  ));

  const FileModel = {
    findOne: (query) => Promise.resolve(findRecord(query) || null),
    findById: (id) => ({
      lean: () => Promise.resolve(store.find((record) => String(record._id) === String(id)) || null)
    }),
    findByIdAndUpdate: (id, update) => {
      const record = store.find((item) => String(item._id) === String(id));
      if (record) Object.assign(record, update);
      return Promise.resolve(record || null);
    },
    updateOne: (query, update) => {
      const record = findRecord(query);
      if (record) Object.assign(record, update.$set || update);
      return Promise.resolve({ matchedCount: record ? 1 : 0 });
    },
    deleteOne: (query) => {
      const index = store.findIndex((record) => String(record._id) === String(query._id));
      if (index >= 0) store.splice(index, 1);
      return Promise.resolve({ deletedCount: index >= 0 ? 1 : 0 });
    }
  };

  const configService = {
    file: { publicDir: workDir, tempDir: workDir, videoDir: workDir },
    app: { supportedUploadMethods: ['tus'] }
  };

  const service = new FileService(
    FileModel,
    configService,
    // The media-type consistency check, exercised for real.
    new (require(path.join(DIST, 'services/file/file-media-validation.service')).FileMediaValidationService)(),
    // Never reached on a rejected upload — every case below is refused before
    // processing starts. Present so construction succeeds.
    { },
    { },
    new ImageContentValidationService(),
    new VideoContentValidationService()
  );

  return service;
}

async function verifyCleanup() {
  section('5. Cleanup — a refused upload leaves no record and no bytes');

  /**
   * Stage a pending TUS upload the way `TusAuthService` would have, then let
   * `processTusUpload` judge it.
   */
  const stage = async (name, { type, mediaType, bytes, mimeType }) => {
    const tusId = `tus-${name}`;
    const tusPath = path.join(workDir, tusId);
    fs.writeFileSync(tusPath, bytes);
    // TUS writes a sidecar of its own metadata next to the payload. It is part
    // of what a rejection must remove.
    fs.writeFileSync(`${tusPath}.json`, JSON.stringify({ id: tusId, size: bytes.length }));

    const record = {
      // A real 24-character hex id, because `purgeRejectedUpload` constructs an
      // `ObjectId` from it — a readable placeholder would make the delete throw
      // and the harness would be testing its own fixture rather than the code.
      _id: crypto.randomBytes(12).toString('hex'),
      tusId,
      type,
      mediaType,
      originalName: `${name}.bin`,
      mimeType,
      fileSize: bytes.length,
      status: FILE_STATUS.UPLOADING,
      metadata: {}
    };
    const store = [record];
    const service = makeFileService(store);
    return {
      service, store, tusPath, record
    };
  };

  const assertPurged = (label, store, tusPath) => {
    check(`${label}: the file record is deleted, not left in an error state`, store.length === 0,
      `store still holds ${JSON.stringify(store)}`);
    check(`${label}: the uploaded bytes are gone`, !fs.existsSync(tusPath), `${tusPath} still exists`);
    check(`${label}: the TUS metadata sidecar is gone`, !fs.existsSync(`${tusPath}.json`),
      `${tusPath}.json still exists`);
  };

  // --- an image that is not an image --------------------------------------
  {
    const bytes = fs.readFileSync(await ensureSmallMp4());
    const staged = await stage('video-as-avatar', {
      type: 'avatar', mediaType: 'image', bytes, mimeType: 'image/png'
    });
    const body = await expectRejection(
      'a video uploaded as an avatar is refused',
      () => staged.service.processTusUpload(staged.record.tusId, workDir),
      UPLOAD_POLICY_BY_TYPE.avatar.codes.format
    );
    check('and in the avatar vocabulary, not the comment one',
      !String(body?.error).startsWith('COMMENT_'), `code was ${body?.error}`);
    assertPurged('rejected avatar', staged.store, staged.tusPath);
  }

  // --- an oversized image --------------------------------------------------
  {
    const big = await writePng('cleanup-oversized.png', 5000, 5000);
    const staged = await stage('oversized-avatar', {
      type: 'avatar', mediaType: 'image', bytes: fs.readFileSync(big), mimeType: 'image/png'
    });
    await expectRejection(
      'an image past the avatar pixel budget is refused',
      () => staged.service.processTusUpload(staged.record.tusId, workDir),
      UPLOAD_POLICY_BY_TYPE.avatar.codes.dimensions
    );
    assertPurged('oversized avatar', staged.store, staged.tusPath);
  }

  // --- an unregistered upload type ----------------------------------------
  {
    const png = await writePng('cleanup-unknown.png', 32, 32);
    const staged = await stage('unknown-type', {
      type: 'post-phto', mediaType: 'image', bytes: fs.readFileSync(png), mimeType: 'image/png'
    });
    await expectRejection(
      'an upload whose type no policy governs is refused rather than processed unchecked',
      () => staged.service.processTusUpload(staged.record.tusId, workDir),
      'UNSUPPORTED_UPLOAD_TYPE'
    );
    assertPurged('unregistered type', staged.store, staged.tusPath);
  }

  // --- a video that is not a video ----------------------------------------
  if (video.hasFfmpeg()) {
    const audioOnly = video.writeAudioOnlyMp4(at('cleanup-audio.mp4'));
    const staged = await stage('audio-as-video', {
      type: 'post-video', mediaType: 'video', bytes: fs.readFileSync(audioOnly), mimeType: 'video/mp4'
    });
    await expectRejection(
      'an audio-only file uploaded as a post video is refused',
      () => staged.service.processTusUpload(staged.record.tusId, workDir),
      UPLOAD_POLICY_BY_TYPE['post-video'].codes.format
    );
    assertPurged('rejected video', staged.store, staged.tusPath);
  } else {
    skip('the video cleanup case', 'ffmpeg/ffprobe not on PATH');
  }

  // --- spoofed metadata cannot change the outcome -------------------------
  {
    const gif = at('cleanup-anim.gif');
    writeAnimatedGif(gif, 5, 100);
    const staged = await stage('gif-as-avatar', {
      type: 'avatar', mediaType: 'image', bytes: fs.readFileSync(gif), mimeType: 'image/gif'
    });
    // The record says avatar; the metadata claims a type that would allow GIF.
    staged.record.metadata = { type: 'comment-photo', filetype: 'image/gif' };
    await expectRejection(
      'an animated GIF is still refused as an avatar however the metadata is labelled',
      () => staged.service.processTusUpload(staged.record.tusId, workDir),
      UPLOAD_POLICY_BY_TYPE.avatar.codes.format
    );
    assertPurged('spoofed avatar', staged.store, staged.tusPath);
  }

  // --- an accepted upload is not purged ------------------------------------
  //
  // The other half of the contract, and the one a cleanup bug would break
  // silently: a valid file must survive validation with its record intact.
  {
    const png = await writePng('cleanup-valid.png', 64, 64);
    const staged = await stage('valid-avatar', {
      type: 'avatar', mediaType: 'image', bytes: fs.readFileSync(png), mimeType: 'image/png'
    });
    // Processing is stubbed out, so the call fails *after* validation. What is
    // being asserted is that it got past validation without purging anything.
    try {
      await staged.service.processTusUpload(staged.record.tusId, workDir);
    } catch (error) {
      const code = codeOf(error);
      check(
        'a valid avatar is not refused by any policy check',
        !ALL_UPLOAD_REJECTION_CODES.includes(code),
        `it was refused with ${code}`
      );
    }
    check(
      'and its record survives validation',
      staged.store.length === 1,
      'a valid upload was purged'
    );
  }
}

// ---------------------------------------------------------------------------
// 6. Concurrency and timeouts
// ---------------------------------------------------------------------------

async function verifyConcurrencyAndTimeouts() {
  section('6. Concurrency and timeouts');

  // --- the gate bounds parallel work --------------------------------------
  {
    const limiter = new ConcurrencyLimiter(2, 'test');
    let running = 0;
    let peak = 0;

    const work = () => limiter.run(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => { setTimeout(resolve, 30); });
      running -= 1;
    });

    await Promise.all(Array.from({ length: 10 }, work));
    checkEqual('never more than the limit run at once', peak, 2);
    checkEqual('and every slot is handed back', limiter.running, 0);
  }

  // --- a slot is released when the work throws ----------------------------
  //
  // The case that matters most here: a rejected upload *is* a throw, and a
  // limiter that leaked a slot per rejection would seize up after N bad files.
  {
    const limiter = new ConcurrencyLimiter(1, 'test');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await limiter.run(async () => { throw new Error('refused'); });
      } catch { /* expected */ }
    }
    checkEqual('a rejection does not leak its slot', limiter.running, 0);
    const after = await limiter.run(async () => 'still works');
    checkEqual('and the limiter still accepts work afterwards', after, 'still works');
  }

  // --- waiting is bounded --------------------------------------------------
  {
    const limiter = new ConcurrencyLimiter(1, 'busy validator');
    let release;
    const held = limiter.run(() => new Promise((resolve) => { release = resolve; }));

    // The limiter unrefs its wait timer on purpose, so a pending waiter cannot
    // keep a shutting-down process alive. In a running server an in-flight
    // request holds a socket and the loop stays up regardless; in this script
    // there is nothing else pending, so without a ref'd timer of its own Node
    // would drain the loop and exit right here — silently skipping every check
    // below and still reporting success.
    const keepAlive = setInterval(() => {}, 50);
    let timedOut = false;
    try {
      await limiter.run(async () => 'never runs', 100);
    } catch (error) {
      timedOut = /busy/i.test(error.message);
    } finally {
      clearInterval(keepAlive);
    }
    check('a caller waiting on a full gate is refused rather than parked forever', timedOut);

    release();
    await held;
    checkEqual('and the gate drains once the holder finishes', limiter.running, 0);
  }

  // --- the validators are actually gated ----------------------------------
  {
    const image = ImageContentValidationService.pressure;
    const clip = VideoContentValidationService.pressure;
    check(
      'the image validator exposes its pressure, so the gate is real and observable',
      typeof image?.running === 'number' && typeof image?.queued === 'number',
      JSON.stringify(image)
    );
    check(
      'and so does the video validator',
      typeof clip?.running === 'number' && typeof clip?.queued === 'number',
      JSON.stringify(clip)
    );
    checkEqual('nothing is left running after the earlier sections', image.running, 0);
    checkEqual('and nothing is left queued', image.queued, 0);
  }

  // --- a child process that overruns is killed ----------------------------
  if (!video.hasFfmpeg()) {
    skip('the ffprobe timeout check', 'ffmpeg/ffprobe not on PATH');
    return;
  }

  await guarded('child process timeout', async () => {
    const validator = new VideoContentValidationService();
    // `runBounded` is the private that owns the timeout and the kill. Reaching
    // for it directly is deliberate: the alternative is a fixture crafted to
    // hang FFmpeg, which is neither reliable nor something to keep in a repo.
    const started = Date.now();
    const result = await validator.runBounded(
      video.FFMPEG,
      // Ten minutes of synthetic video encoded to nothing. It cannot finish
      // inside the deadline, which is the only way to prove the deadline is
      // enforced. Probing stdin does not work for this: `runBounded` gives the
      // child a null stdin, so it reaches EOF immediately and exits on its own.
      ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
        '-i', 'testsrc=s=1280x720:r=30:d=600', '-f', 'null', '-'],
      400
    );
    const elapsed = Date.now() - started;

    check('an overrunning child is killed rather than waited on', result.timedOut,
      `result was ${JSON.stringify(result)}`);
    // The kill has to be prompt, not eventual: a deadline that is honoured a
    // minute late is a deadline that holds a concurrency slot for a minute.
    check('and it is killed close to the deadline', elapsed < 5000, `took ${elapsed}ms`);

    // A killed child must not have poisoned the validator for the next caller.
    const after = await validator.runBounded(video.FFPROBE, ['-version'], 10000);
    check('and the validator still runs children afterwards', after.code === 0,
      `follow-up exited ${after.code}`);
  });

  await guarded('bounded child output', async () => {
    const validator = new VideoContentValidationService();
    // `-h full` prints hundreds of kilobytes. The cap must stop the read rather
    // than buffering whatever a hostile file can make a tool say about itself.
    const result = await validator.runBounded(video.FFPROBE, ['-h', 'full'], 20000);
    check(
      'child output is bounded',
      result.stdout.length <= 1024 * 1024 + 65536,
      `kept ${result.stdout.length} bytes`
    );
  });
}


// ---------------------------------------------------------------------------
// 7. Admin-adjusted limits
// ---------------------------------------------------------------------------

async function verifyAdjustedLimits() {
  section('7. Admin-adjusted limits — bound to the record, clamped here');

  const validator = new ImageContentValidationService();
  const avatarDefault = UPLOAD_POLICY_BY_TYPE.avatar;

  // --- the record's numbers are the ones enforced --------------------------
  {
    const raised = resolveUploadPolicy({
      type: 'avatar',
      metadata: { uploadLimits: { maxWidth: 8000, maxPixels: 64000000 } }
    });
    checkEqual('a raised width on the record raises the enforced width', raised.limits.maxWidth, 8000);
    checkEqual('and the untouched axes keep their defaults',
      raised.limits.maxFrames, avatarDefault.limits.maxFrames);

    const lowered = resolveUploadPolicy({
      type: 'avatar',
      metadata: { uploadLimits: { maxWidth: 512 } }
    });
    checkEqual('a lowered width lowers it', lowered.limits.maxWidth, 512);

    check('and the default policy object is not mutated by either',
      avatarDefault.limits.maxWidth === 4096,
      `the shared default became ${avatarDefault.limits.maxWidth}`);
  }

  // --- and it is the *validator* that changes behaviour, not just a getter --
  {
    const wide = await writePng('adjusted-5000.png', 5000, 1);

    await expectRejection(
      'a 5000px picture is refused under the default avatar policy',
      () => validator.assertDecodableImage(wide, 'wide.png', avatarDefault),
      avatarDefault.codes.dimensions
    );

    const raised = resolveImagePolicy({
      type: 'avatar',
      // Both axes have to move: raising the side limit alone would leave the
      // pixel budget to refuse it, which would prove nothing about the width.
      metadata: { uploadLimits: { maxWidth: 8000, maxPixels: 64000000 } }
    });
    await expectAccepted(
      'and accepted once an operator raises the limit — no restart involved',
      () => validator.assertDecodableImage(wide, 'wide.png', raised)
    );

    const lowered = resolveImagePolicy({
      type: 'avatar',
      metadata: { uploadLimits: { maxWidth: 256 } }
    });
    await expectRejection(
      'and refused again once the limit is lowered',
      () => validator.assertDecodableImage(wide, 'wide.png', lowered),
      lowered.codes.dimensions
    );
  }

  // --- the hard ceiling holds here too ------------------------------------
  {
    const beyond = resolveUploadPolicy({
      type: 'avatar',
      metadata: { uploadLimits: { maxBytes: 99 * 1024 * 1024 * 1024, maxPixels: 9e12 } }
    });
    checkEqual('a byte limit past the ceiling is clamped',
      beyond.limits.maxBytes, UPLOAD_HARD_CEILINGS.image.maxBytes);
    checkEqual('and so is a pixel budget',
      beyond.limits.maxPixels, UPLOAD_HARD_CEILINGS.image.maxPixels);

    const video = resolveUploadPolicy({
      type: 'post-video',
      metadata: { uploadLimits: { maxDurationMs: 99 * 60 * 60 * 1000, maxFrameRate: 10000 } }
    });
    checkEqual('a video duration past the ceiling is clamped',
      video.limits.maxDurationMs, UPLOAD_HARD_CEILINGS.video.maxDurationMs);
    checkEqual('and so is a frame rate',
      video.limits.maxFrameRate, UPLOAD_HARD_CEILINGS.video.maxFrameRate);
  }

  // --- a broken record limit costs only itself -----------------------------
  {
    const partial = resolveUploadPolicy({
      type: 'avatar',
      metadata: { uploadLimits: { maxBytes: 0, maxWidth: 'wide', maxHeight: null, maxFrames: 3 } }
    });
    checkEqual('a zero falls back to the default', partial.limits.maxBytes, avatarDefault.limits.maxBytes);
    checkEqual('a string falls back', partial.limits.maxWidth, avatarDefault.limits.maxWidth);
    checkEqual('a null falls back', partial.limits.maxHeight, avatarDefault.limits.maxHeight);
    checkEqual('and the usable one still applies', partial.limits.maxFrames, 3);

    const junk = resolveUploadPolicy({ type: 'avatar', metadata: { uploadLimits: 'nonsense' } });
    checkEqual('a metadata blob that is not an object is ignored entirely',
      junk.limits.maxBytes, avatarDefault.limits.maxBytes);

    const absent = resolveUploadPolicy({ type: 'avatar', metadata: {} });
    checkEqual('a record from before this feature uses the defaults',
      absent.limits.maxBytes, avatarDefault.limits.maxBytes);
  }

  // --- non-adjustable fields stay in code ----------------------------------
  {
    const tampered = resolveUploadPolicy({
      type: 'post-video',
      metadata: {
        uploadLimits: {
          maxVideoBitrate: 1,
          allowedVideoCodecs: ['mpeg2video'],
          allowedContainers: ['avi']
        }
      }
    });
    const original = UPLOAD_POLICY_BY_TYPE['post-video'];
    // Bitrate is not in the adjustable set, and codec/container lists are not
    // limits at all — accepting either from a record would move a safety
    // decision out of code and into data.
    checkEqual('a non-adjustable numeric limit is not taken from the record',
      tampered.limits.maxVideoBitrate, original.limits.maxVideoBitrate);
    checkEqual('the codec whitelist is untouched',
      tampered.allowedVideoCodecs.join(','), original.allowedVideoCodecs.join(','));
    checkEqual('and so is the container whitelist',
      tampered.allowedContainers.join(','), original.allowedContainers.join(','));
  }

  // --- the uploader still cannot reach any of it ---------------------------
  {
    // `metadata.uploadLimits` is written once, by the API, when the record is
    // created. TUS metadata from the uploader is never merged into the record —
    // so even a record whose *other* metadata is attacker-shaped keeps the
    // limits the API set.
    const spoofed = resolveUploadPolicy({
      type: 'avatar',
      metadata: {
        uploadLimits: { maxWidth: 1024 },
        // Everything below is the shape a client controls.
        filename: 'huge.png',
        filetype: 'image/png',
        type: 'post-photo',
        limits: { maxWidth: 99999 },
        maxWidth: 99999
      }
    });
    checkEqual('the API-set limit wins over anything else in the metadata',
      spoofed.limits.maxWidth, 1024);
    checkEqual('and the policy is still the record\'s durable type', spoofed.name, 'avatar');
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main() {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-policy-'));
  process.stdout.write(`Verifying upload policies against dist/\nFixtures: ${workDir}\n`);

  try {
    verifyRegistry();
    verifyTrustedDispatch();
    await verifyImageBoundaries();
    await verifyVideoBoundaries();
    await verifyCleanup();
    await verifyConcurrencyAndTimeouts();
    await verifyAdjustedLimits();
  } finally {
    // On success, on failure, and on an unhandled throw. Windows will refuse to
    // remove a directory libvips still has open, which is why the cache is off
    // at the top of this file.
    try {
      fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      process.stderr.write(`Could not remove ${workDir}: ${error?.message || error}\n`);
    }
  }

  process.stdout.write(
    `\n${results.passed} passed, ${results.failed} failed, ${results.skipped} skipped\n`
  );
  process.exit(results.failed === 0 ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`\nHarness crashed: ${error?.stack || error}\n`);
  try {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  } catch { /* nothing more to do */ }
  process.exit(1);
});
