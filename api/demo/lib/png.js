/**
 * A minimal PNG encoder, written here rather than pulled in as a dependency.
 *
 * The demo tooling needs exactly one thing from an image library: turn an RGB
 * pixel buffer into a file the project's own upload pipeline will accept. That
 * is a few hundred bytes of chunk framing around `zlib.deflate`, which Node
 * already ships. Adding an image dependency to `api/package.json` so a
 * development-only script can draw a square would put it in the production
 * dependency tree of the API service, which is a poor trade.
 *
 * Output is 8-bit truecolour (colour type 2, no alpha) — avatars are opaque, and
 * an alpha channel the pipeline immediately flattens is a third more bytes for
 * nothing.
 */

const zlib = require('zlib');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

/** Standard PNG/zlib CRC-32 table, built once. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

/** One PNG chunk: length, type, data, CRC over type+data. */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * Encode an RGB buffer (`width * height * 3` bytes, row-major) as a PNG.
 *
 * Every scanline is prefixed with filter type 0 (None). Real encoders choose a
 * filter per row to compress better; for flat gradients the difference is a few
 * kilobytes on a file that is already small, and "None" keeps this readable.
 */
function encodePng(rgb, width, height) {
  const expected = width * height * 3;
  if (rgb.length !== expected) {
    throw new Error(`Pixel buffer is ${rgb.length} bytes, expected ${expected} for ${width}x${height} RGB`);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);  // bit depth
  ihdr.writeUInt8(2, 9);  // colour type 2 = truecolour RGB
  ihdr.writeUInt8(0, 10); // compression: deflate
  ihdr.writeUInt8(0, 11); // filter method: adaptive
  ihdr.writeUInt8(0, 12); // interlace: none

  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type None
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

module.exports = { encodePng };
