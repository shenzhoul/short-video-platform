/**
 * A minimal animated-GIF writer, for fixtures the harness needs and Sharp
 * cannot produce.
 *
 * ## Why this exists
 *
 * Two of the image policies bound animation — a frame count and a playing time —
 * and neither can be tested without a file that actually carries N frames with
 * stated delays. libvips writes animated GIFs only when it is *given* one, so
 * there is nothing in the stack that will produce a 301-frame fixture on demand.
 *
 * It is deliberately tiny rather than general: 4x4 frames, a two-colour global
 * palette, one delay per frame. The frame count and the delays are the only
 * things the tests care about, and everything else is the smallest legal value.
 * Every file it writes is verified by decoding it with the real Sharp/libvips
 * before the harness relies on it — see `verify-upload-policies.js`.
 *
 * ## The LZW trick, and why it is not a shortcut
 *
 * GIF image data is LZW-compressed, and encoder and decoder must agree on when
 * the code width grows: the decoder adds a dictionary entry per code it reads,
 * and widens its codes when its next-free index reaches `2^width`. An encoder
 * that never grows while the decoder does produces a stream that desynchronises
 * a few pixels in — and the failure looks like a corrupt fixture rather than a
 * bug in the writer.
 *
 * So this emits a Clear code before every literal. A Clear resets the decoder's
 * table and its "previous code", so nothing is ever added and the width stays at
 * its initial three bits forever. That is wasteful — two codes per pixel — and
 * completely correct, which for a 4x4 fixture is the right trade.
 */

const fs = require('fs');

/** Frames are this many pixels square. Small on purpose: only the count matters. */
const FRAME_SIZE = 4;

/** Two colours is the smallest legal global palette. */
const PALETTE = [
  [0x00, 0x00, 0x00],
  [0xff, 0xff, 0xff]
];

/**
 * LZW minimum code size.
 *
 * Must be at least 2 even for a two-colour image — the format says so, and a
 * value of 1 is rejected by every decoder worth testing against.
 */
const MIN_CODE_SIZE = 2;
const CLEAR_CODE = 1 << MIN_CODE_SIZE; // 4
const END_CODE = CLEAR_CODE + 1; // 5
const CODE_WIDTH = MIN_CODE_SIZE + 1; // 3 bits, and it never grows

/** Little-endian 16-bit, which is the only multi-byte order GIF uses. */
const u16 = (value) => Buffer.from([value & 0xff, (value >> 8) & 0xff]);

/**
 * Pack codes into a bit stream, least-significant bit first.
 *
 * GIF fills bytes from the low bit up, which is the opposite of most formats and
 * the single easiest thing to get backwards here.
 */
function packCodes(codes) {
  const bytes = [];
  let current = 0;
  let bitsHeld = 0;

  for (const code of codes) {
    current |= code << bitsHeld;
    bitsHeld += CODE_WIDTH;
    while (bitsHeld >= 8) {
      bytes.push(current & 0xff);
      current >>= 8;
      bitsHeld -= 8;
    }
  }
  if (bitsHeld > 0) bytes.push(current & 0xff);

  return Buffer.from(bytes);
}

/** Wrap raw image data in the length-prefixed sub-blocks GIF requires. */
function subBlocks(data) {
  const parts = [];
  for (let offset = 0; offset < data.length; offset += 255) {
    const chunk = data.subarray(offset, offset + 255);
    parts.push(Buffer.from([chunk.length]), chunk);
  }
  parts.push(Buffer.from([0x00])); // Block terminator.
  return Buffer.concat(parts);
}

/**
 * One frame's worth of compressed pixels.
 *
 * `colourIndex` alternates between frames so the animation is visibly an
 * animation rather than the same picture repeated — some decoders elide
 * identical frames, and a fixture that gets deduplicated is not a fixture.
 */
function frameData(colourIndex) {
  const codes = [CLEAR_CODE];
  for (let pixel = 0; pixel < FRAME_SIZE * FRAME_SIZE; pixel += 1) {
    codes.push(CLEAR_CODE, colourIndex);
  }
  codes.push(END_CODE);
  return subBlocks(packCodes(codes));
}

/**
 * Write an animated GIF of `frames` frames, each held for `delayMs`.
 *
 * Delays are stored in centiseconds, which is the only unit GIF has. A delay
 * that is not a whole number of centiseconds is rounded, so the caller should
 * pass a multiple of 10 when the exact playing time matters to an assertion.
 *
 * @param {string} filePath where to write
 * @param {number} frames how many frames
 * @param {number} delayMs per-frame delay in milliseconds
 * @returns {{ frames: number, durationMs: number }} what was actually written
 */
function writeAnimatedGif(filePath, frames, delayMs) {
  if (!Number.isInteger(frames) || frames < 1) {
    throw new Error(`frames must be a positive integer, got ${frames}`);
  }

  const delayCentiseconds = Math.round(delayMs / 10);
  const parts = [];

  // Header and logical screen descriptor.
  parts.push(Buffer.from('GIF89a', 'latin1'));
  parts.push(u16(FRAME_SIZE), u16(FRAME_SIZE));
  // Global colour table present, 8-bit colour resolution, unsorted, 2 entries.
  parts.push(Buffer.from([0xf0, 0x00, 0x00]));
  for (const [r, g, b] of PALETTE) parts.push(Buffer.from([r, g, b]));

  // NETSCAPE2.0 loop extension. Without it some decoders treat the file as a
  // single-play animation, which is still animated but reads oddly in a viewer.
  parts.push(Buffer.from([0x21, 0xff, 0x0b]));
  parts.push(Buffer.from('NETSCAPE2.0', 'latin1'));
  parts.push(Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]));

  for (let index = 0; index < frames; index += 1) {
    // Graphic control extension: the delay lives here, one per frame.
    parts.push(Buffer.from([0x21, 0xf9, 0x04, 0x00]));
    parts.push(u16(delayCentiseconds));
    parts.push(Buffer.from([0x00, 0x00]));

    // Image descriptor: full-frame, no local colour table, not interlaced.
    parts.push(Buffer.from([0x2c]));
    parts.push(u16(0), u16(0), u16(FRAME_SIZE), u16(FRAME_SIZE));
    parts.push(Buffer.from([0x00]));

    parts.push(Buffer.from([MIN_CODE_SIZE]));
    parts.push(frameData(index % PALETTE.length));
  }

  parts.push(Buffer.from([0x3b])); // Trailer.

  fs.writeFileSync(filePath, Buffer.concat(parts));
  return { frames, durationMs: delayCentiseconds * 10 * frames };
}

module.exports = { writeAnimatedGif, FRAME_SIZE };
