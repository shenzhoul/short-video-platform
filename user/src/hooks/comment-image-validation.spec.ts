import {
  COMMENT_IMAGE_ERROR_MESSAGES,
  COMMENT_IMAGE_ERROR_STATUS
} from '@douyin-clone/upload-policy';

import { ANIMATED_IMAGE_FILES, REAL_IMAGE_HEADERS } from './__fixtures__/image-headers';
import {
  ACCEPTED_COMMENT_IMAGE_TYPES,
  classifyOversizeImage,
  classifyPickedFile,
  classifyPickedImageContent,
  COMMENT_IMAGE_DIMENSIONS_EXCEEDED,
  COMMENT_IMAGE_FILE_TOO_LARGE,
  COMMENT_IMAGE_MAX_BYTES,
  describeInvalidImage,
  describeInvalidImageContent,
  describeOversizeImage,
  describeUploadFailure,
  detectImageFormat,
  FILE_TOO_LARGE_MESSAGE,
  IMAGE_TOO_LARGE_MESSAGE,
  INVALID_COMMENT_IMAGE_FORMAT,
  INVALID_IMAGE_MESSAGE,
  isFileTooLargeError,
  isImageTooLargeError,
  isInvalidImageFormatError,
  MAX_COMMENT_IMAGE_DURATION_MS,
  MAX_COMMENT_IMAGE_FRAMES,
  MAX_COMMENT_IMAGE_PIXELS,
  MAX_COMMENT_IMAGE_WIDTH,
  readGifAnimation,
  readImageDimensions,
  readIsoBmffDimensions
} from './use-comment-image';

/**
 * The composer's own judgement about a picked file.
 *
 * The point of this check is that a file's name and its declared MIME type are
 * both chosen by whoever picked it — renaming `clip.mp4` to `clip.png` changes
 * both at once, and every major browser derives `File.type` from the extension.
 * So the fixtures here carry real header bytes, and the assertions are about
 * what those bytes say rather than what the file claims.
 *
 * This is the fast half of a two-sided rule. The file server decodes the whole
 * picture and has the final word; what this buys is that an obviously wrong file
 * costs no upload, leaves no record to clean up, and never raises a "replace the
 * current image?" dialog about something that was never going to be accepted.
 */
describe('picking a comment image', () => {
  /** A File whose bytes are real, whatever we choose to call it. */
  const fileOf = (bytes: number[], name: string, type: string, pad = 64) => {
    const body = new Uint8Array([...bytes, ...new Array(pad).fill(0)]);
    const file = new File([body], name, { type });
    // jsdom's File does not implement slice().arrayBuffer(), which is how the
    // header is read. Backed by the same bytes so the test still measures the
    // sniff rather than a stub of it.
    (file as any).slice = (start: number, end: number) => ({
      arrayBuffer: async () => body.slice(start, end).buffer
    });
    return file;
  };

  const JPEG = [0xff, 0xd8, 0xff, 0xe0];
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
  const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
  const AVIF = [0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66];
  const MP4 = [0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d];
  const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34];
  const SVG = [...'<svg xmlns="http://www.w3.org/2000/svg">'].map((c) => c.charCodeAt(0));

  describe('the header sniff', () => {
    it.each([
      ['JPEG', JPEG, 'jpeg'],
      ['PNG', PNG, 'png'],
      ['GIF', GIF, 'gif'],
      ['WebP', WEBP, 'webp'],
      ['AVIF', AVIF, 'avif']
    ])('recognises %s', (_label, bytes, expected) => {
      expect(detectImageFormat(new Uint8Array([...bytes, ...new Array(20).fill(0)]))).toBe(expected);
    });

    it('does not mistake an MP4 for an AVIF, though they share a box header', () => {
      // Both are ISO-BMFF. Only the brand at offset 8 separates them, which is
      // exactly why the brand is read rather than the box assumed.
      expect(detectImageFormat(new Uint8Array([...MP4, ...new Array(20).fill(0)]))).toBeNull();
    });

    it('rejects a PDF and an SVG', () => {
      expect(detectImageFormat(new Uint8Array([...PDF, ...new Array(20).fill(0)]))).toBeNull();
      expect(detectImageFormat(new Uint8Array([...SVG, ...new Array(20).fill(0)]))).toBeNull();
    });

    it('rejects anything too short to identify', () => {
      expect(detectImageFormat(new Uint8Array([0xff, 0xd8]))).toBeNull();
      expect(detectImageFormat(null as any)).toBeNull();
    });
  });

  describe('the cheap checks', () => {
    it('accepts a plain image', () => {
      expect(describeInvalidImage(fileOf(PNG, 'photo.png', 'image/png'))).toBeNull();
    });

    it('rejects an empty file', () => {
      const empty = new File([], 'empty.png', { type: 'image/png' });
      expect(describeInvalidImage(empty)).toBe(INVALID_IMAGE_MESSAGE);
    });

    it('rejects anything past 10MB as a file-size problem, not a resolution one', () => {
      // The distinction is the point: this picture may be 200x200. Telling its
      // author to use a smaller resolution would be advice that does not apply,
      // so the byte limit gets a code and a message of its own.
      const huge = fileOf(JPEG, 'huge.jpg', 'image/jpeg');
      Object.defineProperty(huge, 'size', { value: COMMENT_IMAGE_MAX_BYTES + 1 });
      expect(classifyPickedFile(huge)).toBe(COMMENT_IMAGE_FILE_TOO_LARGE);
      expect(describeInvalidImage(huge)).toBe(FILE_TOO_LARGE_MESSAGE);
      expect(describeInvalidImage(huge)).not.toBe(IMAGE_TOO_LARGE_MESSAGE);
    });

    it('accepts a file exactly on the byte limit', () => {
      const exact = fileOf(JPEG, 'exact.jpg', 'image/jpeg');
      Object.defineProperty(exact, 'size', { value: COMMENT_IMAGE_MAX_BYTES });
      expect(classifyPickedFile(exact)).toBeNull();
    });

    it('rejects SVG, which a "starts with image/" rule would have let through', () => {
      const svg = fileOf(SVG, 'icon.svg', 'image/svg+xml');
      expect(svg.type.startsWith('image/')).toBe(true);
      expect(describeInvalidImage(svg)).toBe(INVALID_IMAGE_MESSAGE);
      expect(ACCEPTED_COMMENT_IMAGE_TYPES).not.toContain('image/svg+xml');
    });

    it('rejects a declared video or document', () => {
      expect(describeInvalidImage(fileOf(MP4, 'clip.mp4', 'video/mp4'))).toBe(INVALID_IMAGE_MESSAGE);
      expect(describeInvalidImage(fileOf(PDF, 'doc.pdf', 'application/pdf'))).toBe(INVALID_IMAGE_MESSAGE);
    });
  });

  describe('the full check, including the bytes', () => {
    it('accepts every format on the whitelist', async () => {
      // Real encoder output here rather than bare signatures: the check now
      // reads the dimensions out of the same header, and a synthetic one
      // describes a 0x0 picture — which is correctly refused.
      const real = (name: string, filename: string, type: string) => {
        const bytes = Buffer.from(REAL_IMAGE_HEADERS[name], 'base64');
        const file = new File([bytes], filename, { type });
        (file as any).slice = (start: number, end: number) => ({
          arrayBuffer: async () => Uint8Array.from(bytes).slice(start, end).buffer
        });
        return file;
      };

      await expect(describeInvalidImageContent(real('jpeg_1024x768', 'a.jpg', 'image/jpeg'))).resolves.toBeNull();
      await expect(describeInvalidImageContent(real('png_640x480', 'b.png', 'image/png'))).resolves.toBeNull();
      await expect(describeInvalidImageContent(real('webpLossy_333x777', 'c.webp', 'image/webp'))).resolves.toBeNull();
      await expect(describeInvalidImageContent(real('gif_120x90', 'd.gif', 'image/gif'))).resolves.toBeNull();
      // AVIF is measured client-side too, from its `ispe` box — 100x100 here,
      // comfortably inside every limit.
      await expect(describeInvalidImageContent(real('avif_100x100', 'e.avif', 'image/avif'))).resolves.toBeNull();
    });

    it('catches an MP4 renamed .png, which every claim-based check misses', async () => {
      // The file passes the MIME whitelist because the browser derived
      // `image/png` from the extension. Only the bytes give it away.
      const renamed = fileOf(MP4, 'clip.png', 'image/png');
      expect(describeInvalidImage(renamed)).toBeNull();
      await expect(describeInvalidImageContent(renamed)).resolves.toBe(INVALID_IMAGE_MESSAGE);
    });

    it('catches a PDF claiming to be a PNG', async () => {
      const disguised = fileOf(PDF, 'doc.png', 'image/png');
      expect(describeInvalidImage(disguised)).toBeNull();
      await expect(describeInvalidImageContent(disguised)).resolves.toBe(INVALID_IMAGE_MESSAGE);
    });

    it('catches an SVG renamed .png', async () => {
      await expect(describeInvalidImageContent(fileOf(SVG, 'icon.png', 'image/png')))
        .resolves.toBe(INVALID_IMAGE_MESSAGE);
    });

    it('judges an uppercase name by its content', async () => {
      const bytes = Buffer.from(REAL_IMAGE_HEADERS.jpeg_1024x768, 'base64');
      const file = new File([bytes], 'HOLIDAY.JPG', { type: 'image/jpeg' });
      (file as any).slice = (start: number, end: number) => ({
        arrayBuffer: async () => Uint8Array.from(bytes).slice(start, end).buffer
      });
      await expect(describeInvalidImageContent(file)).resolves.toBeNull();
    });

    it('lets the server decide when the bytes cannot be read', async () => {
      // The browser could not answer, so the question goes to the authority
      // rather than blocking a file that may well be fine.
      const unreadable = fileOf(PNG, 'locked.png', 'image/png');
      (unreadable as any).slice = () => ({
        arrayBuffer: async () => {
 throw new Error('read failed');
}
      });
      await expect(describeInvalidImageContent(unreadable)).resolves.toBeNull();
    });

    it('still applies the size limit before reading anything', async () => {
      const huge = fileOf(JPEG, 'huge.jpg', 'image/jpeg');
      Object.defineProperty(huge, 'size', { value: COMMENT_IMAGE_MAX_BYTES + 1 });
      const read = jest.fn();
      (huge as any).slice = read;
      await expect(describeInvalidImageContent(huge)).resolves.toContain('10MB');
      expect(read).not.toHaveBeenCalled();
    });
  });

  describe('recognising the server saying no', () => {
    it('matches the stable code wherever it is carried', () => {
      // `.code` is where the upload service attaches it after a failed TUS
      // request, so it counts too.
      expect(isInvalidImageFormatError({ code: 'INVALID_COMMENT_IMAGE_FORMAT' })).toBe(true);
      expect(isInvalidImageFormatError({ error: 'INVALID_COMMENT_IMAGE_FORMAT' })).toBe(true);
      expect(isInvalidImageFormatError({ response: { data: { error: 'INVALID_COMMENT_IMAGE_FORMAT' } } })).toBe(true);
      expect(isInvalidImageFormatError({ message: { error: 'INVALID_COMMENT_IMAGE_FORMAT' } })).toBe(true);
    });

    it('does not treat an ordinary failure as a format problem', () => {
      expect(isInvalidImageFormatError({ error: 'NETWORK' })).toBe(false);
      expect(isInvalidImageFormatError(null)).toBe(false);
    });
  });
});

describe('reading the size of a picture without decoding it', () => {
  const bytesOf = (name: string) => Uint8Array.from(
    Buffer.from(REAL_IMAGE_HEADERS[name], 'base64')
  );

  it.each([
    ['png_640x480', 640, 480],
    ['jpeg_1024x768', 1024, 768],
    ['jpegProgressive_800x600', 800, 600],
    ['webpLossy_333x777', 333, 777],
    ['webpLossless_300x200', 300, 200],
    ['gif_120x90', 120, 90],
    ['pngBomb_9000x9000', 9000, 9000]
  ])('reads %s from its header alone', (name, width, height) => {
    expect(readImageDimensions(bytesOf(name as string))).toEqual({ width, height });
  });

  it('reads AVIF out of its nested ispe box', () => {
    // The one format whose size is not at a fixed offset. Measuring it here is
    // what keeps an oversized AVIF from reaching the replace-image dialog, and
    // it is done by walking boxes rather than by handing the file to a decoder.
    expect(readImageDimensions(bytesOf('avif_100x100'))).toEqual({ width: 100, height: 100 });
    expect(readImageDimensions(bytesOf('avif_13000x100'))).toEqual({ width: 13000, height: 100 });
  });

  it('reads HEIC the same way, since it is the same box structure', () => {
    expect(readImageDimensions(bytesOf('heic_13000x100'))).toEqual({ width: 13000, height: 100 });
  });

  it('returns null for bytes that are not an image', () => {
    expect(readImageDimensions(Uint8Array.from([1, 2, 3]))).toBeNull();
    expect(readImageDimensions(new Uint8Array(40))).toBeNull();
  });
});

describe('the resolution limit', () => {
  it('accepts a picture exactly on the width limit', () => {
    // 12000 wide is allowed; the pixel budget still has to hold, so this shape
    // is 12000 x 3333 = 39,996,000.
    expect(describeOversizeImage({ width: MAX_COMMENT_IMAGE_WIDTH, height: 3333 })).toBeNull();
  });

  it('rejects one pixel over the width limit', () => {
    expect(describeOversizeImage({ width: MAX_COMMENT_IMAGE_WIDTH + 1, height: 10 }))
      .toBe(IMAGE_TOO_LARGE_MESSAGE);
  });

  it('rejects one pixel over the height limit', () => {
    expect(describeOversizeImage({ width: 10, height: MAX_COMMENT_IMAGE_WIDTH + 1 }))
      .toBe(IMAGE_TOO_LARGE_MESSAGE);
  });

  it('accepts a picture exactly on the pixel budget', () => {
    expect(describeOversizeImage({ width: 8000, height: 5000 })).toBeNull();
    expect(8000 * 5000).toBe(MAX_COMMENT_IMAGE_PIXELS);
  });

  it('rejects one pixel over the budget', () => {
    expect(describeOversizeImage({ width: 8000, height: 5001 })).toBe(IMAGE_TOO_LARGE_MESSAGE);
  });

  it('rejects nonsense dimensions as a format problem', () => {
    // Zero or negative is not "too big"; it means the header is not describing
    // a picture at all.
    expect(describeOversizeImage({ width: 0, height: 100 })).toBe(INVALID_IMAGE_MESSAGE);
    expect(describeOversizeImage({ width: 100, height: 0 })).toBe(INVALID_IMAGE_MESSAGE);
  });

  it('says nothing when the size could not be read', () => {
    // The server measures it instead of the client blocking a file that may be
    // perfectly fine.
    expect(describeOversizeImage(null)).toBeNull();
  });

  it('turns down a real decompression bomb', async () => {
    // 257KB of PNG, 81 million pixels. Well under the 10MB byte limit, which is
    // the whole reason the byte limit is not enough on its own.
    const bomb = Buffer.from(REAL_IMAGE_HEADERS.pngBomb_9000x9000, 'base64');
    const file = new File([bomb], 'innocent.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 262952 });
    (file as any).slice = (start: number, end: number) => ({
      arrayBuffer: async () => Uint8Array.from(bomb).slice(start, end).buffer
    });

    expect(file.size).toBeLessThan(COMMENT_IMAGE_MAX_BYTES);
    await expect(describeInvalidImageContent(file)).resolves.toBe(IMAGE_TOO_LARGE_MESSAGE);
  });

  it('still accepts an ordinary photograph', async () => {
    const png = Buffer.from(REAL_IMAGE_HEADERS.png_640x480, 'base64');
    const file = new File([png], 'photo.png', { type: 'image/png' });
    (file as any).slice = (start: number, end: number) => ({
      arrayBuffer: async () => Uint8Array.from(png).slice(start, end).buffer
    });
    await expect(describeInvalidImageContent(file)).resolves.toBeNull();
  });
});

describe('mapping a failed upload to a message', () => {
  it('separates a refused resolution from a refused format', () => {
    expect(describeUploadFailure({ code: 'COMMENT_IMAGE_DIMENSIONS_EXCEEDED' }))
      .toBe(IMAGE_TOO_LARGE_MESSAGE);
    expect(describeUploadFailure({ code: 'INVALID_COMMENT_IMAGE_FORMAT' }))
      .toBe(INVALID_IMAGE_MESSAGE);
  });

  it('falls back to a generic message for anything else', () => {
    // A dropped connection is not the author's fault and there is nothing for
    // them to fix about the file.
    expect(describeUploadFailure({ code: 'ECONNRESET' })).toContain('could not be uploaded');
    expect(describeUploadFailure(null)).toContain('could not be uploaded');
  });

  it('finds the code wherever the transport put it', () => {
    expect(isImageTooLargeError({ error: 'COMMENT_IMAGE_DIMENSIONS_EXCEEDED' })).toBe(true);
    expect(isImageTooLargeError({ response: { data: { error: 'COMMENT_IMAGE_DIMENSIONS_EXCEEDED' } } })).toBe(true);
    expect(isImageTooLargeError({ code: 'COMMENT_IMAGE_DIMENSIONS_EXCEEDED' })).toBe(true);
    expect(isImageTooLargeError({ error: 'INVALID_COMMENT_IMAGE_FORMAT' })).toBe(false);
    expect(isInvalidImageFormatError({ code: 'INVALID_COMMENT_IMAGE_FORMAT' })).toBe(true);
  });
});

/**
 * The three-code contract.
 *
 * Every rejection anywhere in the chain — composer, API, file server, TUS —
 * carries exactly one of three codes, and the composer decides what to say from
 * the code alone. These tests are about that contract rather than about any one
 * check: that the three are distinct, that each maps to its own message, and
 * that nothing is decided by reading a sentence.
 */
describe('the three error codes', () => {
  const CODES = [
    INVALID_COMMENT_IMAGE_FORMAT,
    COMMENT_IMAGE_FILE_TOO_LARGE,
    COMMENT_IMAGE_DIMENSIONS_EXCEEDED
  ];

  it('are three distinct strings', () => {
    expect(new Set(CODES).size).toBe(3);
  });

  it('map to three distinct messages', () => {
    const messages = CODES.map((code) => describeUploadFailure({ code }));
    expect(messages).toEqual([
      'Invalid image format',
      'Image must be 10MB or smaller',
      'Image resolution is too large'
    ]);
    expect(new Set(messages).size).toBe(3);
  });

  it('carry the status each one deserves', () => {
    // 413 is the one place the transport itself has something to say. The other
    // two are ordinary refused payloads and stay 400, like every other
    // validation failure in the API.
    expect(COMMENT_IMAGE_ERROR_STATUS.COMMENT_IMAGE_FILE_TOO_LARGE).toBe(413);
    expect(COMMENT_IMAGE_ERROR_STATUS.INVALID_COMMENT_IMAGE_FORMAT).toBe(400);
    expect(COMMENT_IMAGE_ERROR_STATUS.COMMENT_IMAGE_DIMENSIONS_EXCEEDED).toBe(400);
  });

  it('are recognised one at a time, never as a group', () => {
    const format = { code: INVALID_COMMENT_IMAGE_FORMAT };
    const bytes = { code: COMMENT_IMAGE_FILE_TOO_LARGE };
    const pixels = { code: COMMENT_IMAGE_DIMENSIONS_EXCEEDED };

    expect([isInvalidImageFormatError(format), isFileTooLargeError(format), isImageTooLargeError(format)])
      .toEqual([true, false, false]);
    expect([isInvalidImageFormatError(bytes), isFileTooLargeError(bytes), isImageTooLargeError(bytes)])
      .toEqual([false, true, false]);
    expect([isInvalidImageFormatError(pixels), isFileTooLargeError(pixels), isImageTooLargeError(pixels)])
      .toEqual([false, false, true]);
  });

  it('are read from the code even when the message says something else', () => {
    // The wording is free to change or be translated on either side. A client
    // that matched sentences would start showing the fallback the day it did.
    const misleading = {
      code: COMMENT_IMAGE_FILE_TOO_LARGE,
      message: 'That image resolution is too large'
    };
    expect(describeUploadFailure(misleading)).toBe(FILE_TOO_LARGE_MESSAGE);
  });

  it('survives the shape TUS and axios each wrap an error in', () => {
    // The file server answers TUS with a JSON body; axios nests it under
    // `response.data`. Both have to resolve to the same code.
    expect(describeUploadFailure({ response: { data: { error: COMMENT_IMAGE_FILE_TOO_LARGE } } }))
      .toBe(FILE_TOO_LARGE_MESSAGE);
    expect(describeUploadFailure({ data: { error: COMMENT_IMAGE_DIMENSIONS_EXCEEDED } }))
      .toBe(IMAGE_TOO_LARGE_MESSAGE);
  });

  it('never reports a byte-count rejection as a resolution one', () => {
    // The regression this whole split exists to prevent.
    expect(describeUploadFailure({ code: COMMENT_IMAGE_FILE_TOO_LARGE }))
      .not.toBe(IMAGE_TOO_LARGE_MESSAGE);
    expect(COMMENT_IMAGE_ERROR_MESSAGES.COMMENT_IMAGE_FILE_TOO_LARGE)
      .not.toBe(COMMENT_IMAGE_ERROR_MESSAGES.COMMENT_IMAGE_DIMENSIONS_EXCEEDED);
  });
});

/**
 * AVIF and HEIC, measured rather than deferred.
 *
 * These two used to pass the client check unmeasured, which meant an oversized
 * one reached the "replace the current image?" dialog — a destructive question
 * asked about a file that was never going to be accepted. Their size lives in a
 * nested `ispe` box, so it takes a box walker to read; what it must never take
 * is a decoder, because handing an `<img>` or `createImageBitmap` the file would
 * rasterise the very thing the limit exists to refuse.
 */
describe('measuring AVIF and HEIC without decoding them', () => {
  const fileFrom = (name: string, filename: string, type: string) => {
    const bytes = Buffer.from(REAL_IMAGE_HEADERS[name], 'base64');
    const file = new File([bytes], filename, { type });
    (file as any).slice = (start: number, end: number) => ({
      arrayBuffer: async () => Uint8Array.from(bytes).slice(start, end).buffer
    });
    (file as any).arrayBuffer = async () => Uint8Array.from(bytes).buffer;
    return file;
  };

  it('refuses an oversized AVIF before anything is uploaded', async () => {
    const file = fileFrom('avif_13000x100', 'wide.avif', 'image/avif');
    await expect(classifyPickedImageContent(file)).resolves.toBe(COMMENT_IMAGE_DIMENSIONS_EXCEEDED);
    await expect(describeInvalidImageContent(file)).resolves.toBe(IMAGE_TOO_LARGE_MESSAGE);
  });

  it('refuses an oversized HEIC the same way', async () => {
    const file = fileFrom('heic_13000x100', 'wide.heic', 'image/heic');
    await expect(classifyPickedImageContent(file)).resolves.toBe(COMMENT_IMAGE_DIMENSIONS_EXCEEDED);
  });

  it('still accepts an ordinary AVIF', async () => {
    await expect(classifyPickedImageContent(fileFrom('avif_100x100', 'ok.avif', 'image/avif')))
      .resolves.toBeNull();
  });

  it('does not touch a decoder to find out', async () => {
    // If the walker ever regressed into asking the browser, these would be
    // called — and the file under test is exactly the one that must not be
    // handed to a decoder.
    const createImageBitmap = jest.fn();
    (global as any).createImageBitmap = createImageBitmap;
    const imageSrc = jest.spyOn(global.Image.prototype, 'src', 'set');

    await classifyPickedImageContent(fileFrom('avif_13000x100', 'wide.avif', 'image/avif'));

    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(imageSrc).not.toHaveBeenCalled();
    imageSrc.mockRestore();
    delete (global as any).createImageBitmap;
  });

  it('walks hostile box trees without hanging', () => {
    // Every one of these is a real way a crafted file could spin a naive
    // walker: a zero-length box, a length that points backwards, a length past
    // the end of the buffer, and a box that claims to be 2^63 bytes.
    const box = (size: number[], type: string) => [
      ...size, ...[...type].map((c) => c.charCodeAt(0))
    ];
    const ftyp = box([0, 0, 0, 16], 'ftyp');
    const brand = [...'avif'].map((c) => c.charCodeAt(0));

    const zeroLength = new Uint8Array([...ftyp, ...brand, 0, 0, 0, 0, ...box([0, 0, 0, 0], 'meta')]);
    const shortLength = new Uint8Array([...ftyp, ...brand, 0, 0, 0, 0, ...box([0, 0, 0, 2], 'meta')]);
    const pastEnd = new Uint8Array([...ftyp, ...brand, 0, 0, 0, 0, ...box([0xff, 0xff, 0xff, 0xff], 'meta')]);
    const huge = new Uint8Array([
      ...ftyp, ...brand, 0, 0, 0, 0,
      ...box([0, 0, 0, 1], 'meta'), 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff
    ]);

    for (const bytes of [zeroLength, shortLength, pastEnd, huge]) {
      const started = Date.now();
      expect(readIsoBmffDimensions(bytes)).toBeNull();
      expect(Date.now() - started).toBeLessThan(1000);
    }
  });
});

/**
 * The frame and duration policy.
 *
 * A frame flood is the abusive animation every other limit lets through: 4x4
 * frames cost nothing in bytes and nothing in pixels, and the cost that matters
 * — per-frame parsing, allocation and re-encoding — is the one neither budget
 * measures. The GIF fixtures below are complete files, because frame count is
 * only knowable by walking a GIF to its trailer.
 */
describe('the frame and duration limits', () => {
  const animationFile = (name: string, filename = 'anim.gif') => {
    const bytes = Buffer.from(ANIMATED_IMAGE_FILES[name], 'base64');
    const file = new File([bytes], filename, { type: 'image/gif' });
    (file as any).slice = (start: number, end: number) => ({
      arrayBuffer: async () => Uint8Array.from(bytes).slice(start, end).buffer
    });
    (file as any).arrayBuffer = async () => Uint8Array.from(bytes).buffer;
    return file;
  };
  const bytesOf = (name: string) => Uint8Array.from(Buffer.from(ANIMATED_IMAGE_FILES[name], 'base64'));

  it('counts frames by walking the block stream', () => {
    expect(readGifAnimation(bytesOf('gif_4x4_300frames'))).toEqual({ frames: 300, durationMs: 12000 });
  });

  it('accepts exactly 300 frames inside the pixel and duration budgets', async () => {
    // 300 x 4 x 4 = 4800 pixels and 12 seconds. Nothing else about this file is
    // remarkable, which is what makes it the boundary case.
    expect(MAX_COMMENT_IMAGE_FRAMES).toBe(300);
    await expect(classifyPickedImageContent(animationFile('gif_4x4_300frames'))).resolves.toBeNull();
  });

  it('rejects 301 frames', async () => {
    await expect(classifyPickedImageContent(animationFile('gif_4x4_301frames')))
      .resolves.toBe(COMMENT_IMAGE_DIMENSIONS_EXCEEDED);
    await expect(describeInvalidImageContent(animationFile('gif_4x4_301frames')))
      .resolves.toBe(IMAGE_TOO_LARGE_MESSAGE);
  });

  it('stops walking a frame flood instead of counting all of it', () => {
    // The walk gives up the moment the count passes the limit; whatever the
    // real total is, the answer is already decided.
    const counted = readGifAnimation(bytesOf('gif_4x4_301frames'));
    expect(counted!.frames).toBe(301);
    expect(counted!.frames).toBeGreaterThan(MAX_COMMENT_IMAGE_FRAMES);
  });

  it('rejects an animation that plays for too long, under the frame limit', async () => {
    // 100 frames — a third of the limit — at half a second each. Frame count
    // alone would let five minutes of animation through, which is why duration
    // is a separate axis rather than a consequence of the frame cap.
    const file = animationFile('gif_4x4_50seconds');
    const walked = readGifAnimation(bytesOf('gif_4x4_50seconds'));
    expect(walked).toEqual({ frames: 100, durationMs: 50000 });
    expect(walked!.frames).toBeLessThan(MAX_COMMENT_IMAGE_FRAMES);
    expect(walked!.durationMs).toBeGreaterThan(MAX_COMMENT_IMAGE_DURATION_MS);
    await expect(classifyPickedImageContent(file)).resolves.toBe(COMMENT_IMAGE_DIMENSIONS_EXCEEDED);
  });

  it('rejects a pixel budget blown by frames rather than by size', () => {
    // 4000 x 4000 is a fine still. Three of them is not, and neither the side
    // limits nor the frame limit would notice.
    expect(classifyOversizeImage({ width: 4000, height: 4000, frames: 3 }))
      .toBe(COMMENT_IMAGE_DIMENSIONS_EXCEEDED);
    expect(classifyOversizeImage({ width: 4000, height: 4000, frames: 2 })).toBeNull();
  });

  it('treats an unmeasurable animation as a still rather than as zero frames', () => {
    // A format whose frames the client cannot count is not thereby unlimited —
    // it is simply the server's question. Counting it as one frame is what makes
    // the client a hint rather than a hole.
    expect(classifyOversizeImage({ width: 100, height: 100, frames: null })).toBeNull();
    expect(classifyOversizeImage({ width: 13000, height: 100, frames: null }))
      .toBe(COMMENT_IMAGE_DIMENSIONS_EXCEEDED);
  });

  it('leaves a still GIF alone', () => {
    const still = Uint8Array.from(Buffer.from(REAL_IMAGE_HEADERS.gif_120x90, 'base64'));
    expect(readGifAnimation(still)).toEqual({ frames: 1, durationMs: 0 });
  });
});
