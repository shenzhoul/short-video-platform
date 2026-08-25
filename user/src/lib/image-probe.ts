/**
 * What a picked file is, and how much of it there is, read from its own bytes.
 *
 * ## Why the browser is not asked
 *
 * `File.type` is derived from the extension in every major browser, so renaming
 * `clip.mp4` to `clip.png` produces a `File` that claims to be a PNG. And the
 * obvious way to measure a picture — hand it to an `<img>` or
 * `createImageBitmap` — asks the browser to rasterise the very file whose size
 * is in question, which is the thing a pixel budget exists to prevent.
 *
 * So everything here parses headers instead. Each format states its size in its
 * first few bytes; none of them has to be drawn to be measured.
 *
 * ## Where this came from
 *
 * These parsers were written for the comment composer and lived inside
 * `use-comment-image.ts`. They are not comment-specific — a post photo, an
 * avatar and a message picture are measured exactly the same way — so they moved
 * here when every upload type got its own policy. `use-comment-image` re-exports
 * them unchanged, so the composer's contract is untouched.
 *
 * The one thing that *was* comment-specific is now an argument: `readGifAnimation`
 * takes the frame cap it should stop counting at, because the cap belongs to the
 * policy and not to the parser.
 *
 * ## The client is a hint, the server is the authority
 *
 * Nothing here is enforcement. The file server decodes the whole picture and has
 * the final say. What this buys is that an obviously wrong file never costs an
 * upload, never creates a record to clean up, and never replaces a valid
 * attachment with one that was always going to be refused.
 */

/** Enough of a file to find a JPEG frame header or an ISO-BMFF `ispe`. */
export const DIMENSION_SCAN_BYTES = 65536;

/** What a header parse can tell us about how much picture there is. */
export interface ImageMeasurement {
  width: number;
  height: number;
  /** Frames when they could be counted; `null` when the format hides them. */
  frames?: number | null;
  /** Playing time in ms when it could be summed; `null` otherwise. */
  durationMs?: number | null;
}

const headerMatches = (bytes: Uint8Array, signature: number[], offset = 0) => {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
};

/**
 * What these bytes really are, or `null` for anything not in the whitelist.
 *
 * The same sniff the file server runs, for the same reason: `File.type` is
 * derived from the extension in every major browser, so renaming `clip.mp4` to
 * `clip.png` produces a `File` that claims to be a PNG. Only the bytes the
 * encoder wrote say otherwise.
 */
export function detectImageFormat(bytes: Uint8Array): string | null {
  if (!bytes || bytes.length < 12) return null;
  if (headerMatches(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (headerMatches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (headerMatches(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (headerMatches(bytes, [0x52, 0x49, 0x46, 0x46]) && headerMatches(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'webp';
  }
  // AVIF and HEIC share their box structure with MP4, so the brand at offset 8
  // is what separates a picture from a video rather than the box itself.
  if (headerMatches(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...bytes.subarray(8, 12)).toLowerCase();
    return ['avif', 'avis', 'heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)
      ? 'avif'
      : null;
  }
  return null;
}

/**
 * AVIF/HEIC dimensions, from the `ispe` box, without decoding anything.
 *
 * ## Why this is worth writing out
 *
 * These two are the formats whose size is not at a fixed offset: it sits in
 * `meta > iprp > ipco > ispe`, several boxes deep. The easy alternatives are
 * both wrong here — asking an `<img>` or `createImageBitmap` for the size means
 * handing the decoder the very file whose size is in question, which is the
 * thing the pixel budget exists to prevent — so the box tree is walked instead.
 *
 * The walk touches only box headers: four bytes of length and four of type, then
 * a jump. It never reads pixel data and never allocates anything proportional to
 * the picture, so an eight-gigapixel AVIF costs exactly as much to measure as a
 * thumbnail.
 *
 * ## What makes it safe on hostile input
 *
 * Every one of these is a real way a crafted file could hang a naive walker:
 *
 *  - a zero or negative box length would advance the cursor by nothing and loop
 *    forever, so any length under the 8-byte header ends the walk;
 *  - a 64-bit `largesize` is read but refused if it does not fit a safe integer;
 *  - a length that runs past the buffer is clamped to it;
 *  - nesting is capped, so a box tree cannot recurse without bound;
 *  - the total number of boxes visited is capped, so a file made of a million
 *    empty boxes cannot spend the main thread.
 *
 * A multi-image HEIC carries one `ispe` per item; the largest is what gets
 * measured, because the limit has to hold for whichever one the pipeline picks.
 */
export function readIsoBmffDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (!bytes || bytes.length < 16) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  /** Boxes whose payload is a list of other boxes rather than data. */
  const CONTAINERS = ['meta', 'iprp', 'ipco'];
  /** `meta` is a full box: a version byte and three flag bytes come first. */
  const FULL_BOXES = ['meta'];
  const MAX_DEPTH = 6;
  const MAX_BOXES = 4096;

  let visited = 0;
  let largest: { width: number; height: number } | null = null;

  const walk = (start: number, end: number, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let offset = start;

    while (offset + 8 <= end && visited < MAX_BOXES) {
      visited += 1;

      let size = view.getUint32(offset);
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      let headerSize = 8;

      if (size === 1) {
        // 64-bit length. Anything past 2^53 cannot be represented exactly, and
        // a file that large is not arriving through this composer anyway.
        if (offset + 16 > end) return;
        const high = view.getUint32(offset + 8);
        const low = view.getUint32(offset + 12);
        if (high > 0x001fffff) return;
        size = high * 0x100000000 + low;
        headerSize = 16;
      } else if (size === 0) {
        // "To the end of the file" — legal, and the last box either way.
        size = end - offset;
      }

      if (size < headerSize) return;

      const boxEnd = Math.min(offset + size, end);
      const payload = offset + headerSize + (FULL_BOXES.includes(type) ? 4 : 0);

      if (type === 'ispe') {
        // `ispe` is a full box: version and flags, then width and height.
        if (payload + 12 <= boxEnd) {
          const width = view.getUint32(payload + 4);
          const height = view.getUint32(payload + 8);
          if (width > 0 && height > 0) {
            if (!largest || width * height > largest.width * largest.height) {
              largest = { width, height };
            }
          }
        }
      } else if (CONTAINERS.includes(type) && payload < boxEnd) {
        walk(payload, boxEnd, depth + 1);
      }

      offset = boxEnd;
    }
  };

  walk(0, bytes.length, 0);
  return largest;
}

/**
 * A picture's dimensions read straight out of its header.
 *
 * Deliberately parses rather than decodes. Handing the bytes to the browser —
 * an `Image` element, `createImageBitmap` — would ask it to rasterise the very
 * file being checked, which is the thing the limit exists to avoid. Every format
 * here states its size in the first few bytes; none of them has to be drawn to
 * be measured.
 *
 * Returns `null` only when the size genuinely is not in the bytes we read, in
 * which case the question goes to the server, which measures every format
 * properly.
 */
export function readImageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (!bytes || bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // PNG: IHDR is always the first chunk, width and height big-endian at 16.
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  // GIF: little-endian, immediately after the signature.
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }

  // WebP: three sub-formats, each storing the size in its own place.
  if (bytes[0] === 0x52 && bytes[8] === 0x57 && bytes[9] === 0x45) {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === 'VP8X' && bytes.length > 30) {
      const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { width: w, height: h };
    }
    if (chunk === 'VP8 ' && bytes.length > 30) {
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff
      };
    }
    if (chunk === 'VP8L' && bytes.length > 25) {
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);

      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }

  // JPEG: walk the marker segments to the frame header, which is the only one
  // that carries the size. Bounded by the buffer it was given.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
 offset += 1; continue;
}
      const marker = bytes[offset + 1];
      // SOF0..SOF15, skipping the four that are not frame headers.
      if (marker >= 0xc0 && marker <= 0xcf
        && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc && marker !== 0xc9) {
        return {
          height: view.getUint16(offset + 5),
          width: view.getUint16(offset + 7)
        };
      }
      const length = view.getUint16(offset + 2);
      if (length < 2) return null;
      offset += 2 + length;
    }
    return null;
  }

  // AVIF and HEIC: the size lives in a nested `ispe` box rather than at a fixed
  // offset, so it needs a walker of its own.
  if (headerMatches(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    return readIsoBmffDimensions(bytes);
  }

  return null;
}

/**
 * How many frames a GIF holds, and how long it plays.
 *
 * ## Why a GIF gets a whole-file walk when nothing else does
 *
 * Frame count is not in a GIF's header. It is only knowable by walking the block
 * stream to the trailer, because frames are simply appended. That walk is
 * bookkeeping — read a block type, skip its sub-blocks — and never decodes an
 * LZW stream, so it costs a pass over bytes that are already in memory.
 *
 * It matters because a frame flood is the one abusive animation that every other
 * limit lets through: three thousand 16x16 frames is 354KB and 768k pixels, well
 * inside the byte and pixel budgets, and expensive in exactly the way those
 * budgets do not measure.
 *
 * The walk stops as soon as the count passes the limit, so a hostile file is
 * refused after a few hundred frames rather than after all of them.
 *
 * Delays are summed in the units the file states (centiseconds, converted to
 * ms). A GIF that stores 0 delays plays slower than that sum, never faster, so
 * this can only ever under-report — which is the right direction for a client
 * hint: it refuses only what is definitely over, and leaves everything else for
 * the server to settle.
 */
export function readGifAnimation(
  bytes: Uint8Array,
  maxFrames: number,
  walkLimitBytes: number
): { frames: number; durationMs: number } | null {
  if (!bytes || bytes.length < 13) return null;
  if (!(bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46)) return null;

  const end = Math.min(bytes.length, walkLimitBytes);
  let offset = 6;

  // Logical screen descriptor, then the global colour table if there is one.
  const packed = bytes[10];
  offset = 13;
  if (packed & 0x80) offset += 3 * (1 << ((packed & 0x07) + 1));

  let frames = 0;
  let durationMs = 0;

  /** Skip a chain of length-prefixed sub-blocks, ending at the zero length. */
  const skipSubBlocks = (from: number): number => {
    let cursor = from;
    while (cursor < end) {
      const length = bytes[cursor];
      cursor += 1;
      if (!length) return cursor;
      cursor += length;
    }
    return end;
  };

  while (offset < end) {
    const block = bytes[offset];

    if (block === 0x3b) break; // Trailer.

    if (block === 0x21) {
      // Extension. The graphic control extension is the one that carries a
      // delay, and it always precedes the frame it applies to.
      const label = bytes[offset + 1];
      if (label === 0xf9 && offset + 5 < end) {
        durationMs += (bytes[offset + 4] | (bytes[offset + 5] << 8)) * 10;
      }
      offset = skipSubBlocks(offset + 2);
      continue;
    }

    if (block === 0x2c) {
      // Image descriptor: one frame.
      frames += 1;
      // Refusing early: past the limit, the exact count stops mattering and
      // walking the rest of a hostile file would be work done for nothing.
      if (frames > maxFrames) {
        return { frames, durationMs };
      }
      const localPacked = bytes[offset + 9];
      let cursor = offset + 10;
      if (localPacked & 0x80) cursor += 3 * (1 << ((localPacked & 0x07) + 1));
      cursor += 1; // LZW minimum code size.
      offset = skipSubBlocks(cursor);
      continue;
    }

    // Anything else means the stream is not what it claims. The decoder on the
    // server will say so properly; there is nothing more to count here.
    return frames ? { frames, durationMs } : null;
  }

  return frames ? { frames, durationMs } : null;
}
