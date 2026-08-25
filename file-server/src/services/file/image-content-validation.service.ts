import { HttpException, Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as sharp from 'sharp';

import { ConcurrencyLimiter } from '../../lib/concurrency';
import {
  detectImageFormat,
  IMAGE_METADATA_INSPECTION_CEILING,
  IMAGE_SNIFF_BYTES,
  mimeTypeForFormat,
  normaliseDecodedFormat
} from '../../lib/image-content';
import {
  ImageLimits,
  ImageUploadPolicy,
  UPLOAD_POLICY_BY_TYPE
} from './upload-policy';

export { ImageLimits, ImageUploadPolicy };

/**
 * The comment-image policy, kept as a named export for existing callers.
 *
 * It is one row of the registry, not a default — see `upload-policy.ts` for why
 * a post photo answers with different codes and a different budget.
 */
export const COMMENT_IMAGE_POLICY = UPLOAD_POLICY_BY_TYPE['comment-photo'] as ImageUploadPolicy;

/** The comment-image codes, for callers that report them by name. */
export const INVALID_IMAGE_FORMAT_CODE = COMMENT_IMAGE_POLICY.codes.format;
export const IMAGE_FILE_TOO_LARGE_CODE = COMMENT_IMAGE_POLICY.codes.fileTooLarge;
export const IMAGE_DIMENSIONS_EXCEEDED_CODE = COMMENT_IMAGE_POLICY.codes.dimensions;

/** The comment-image limits, for callers that want to report them. */
export const COMMENT_IMAGE_LIMITS: ImageLimits = COMMENT_IMAGE_POLICY.limits;

export interface VerifiedImage {
  /** What the bytes actually are, whatever the request claimed. */
  format: string;
  /** The MIME type that belongs to those bytes. */
  mimeType: string;
  /** One frame's dimensions, not the stacked height of an animation. */
  width: number;
  height: number;
  /** Frames for a GIF, pages for AVIF/HEIC; 1 for a still. */
  frames: number;
  /** width x height x frames — what a decoder actually has to hold. */
  decodedPixels: number;
  /**
   * Playing time in milliseconds, or `null` when the decoder reported no
   * usable per-frame delays. `null` means "not measurable", never "zero".
   */
  durationMs: number | null;
  /** Which policy judged it, so a caller can log what was actually applied. */
  policy: string;
}

/**
 * Decides whether an uploaded file really is an image the pipeline can use.
 *
 * ## The policy is an argument, and there is no default
 *
 * Which limits apply comes from the durable upload type on the file record —
 * see `upload-policy.ts`. Every registered type has its own policy and the
 * caller must name one; there is deliberately no fallback, because a default
 * either means "the strictest policy in the system", which silently re-scopes
 * every upload that forgot to choose, or "no limits at all", which is what most
 * of the product's uploads used to get.
 *
 * **Always, whichever policy applies:**
 *
 * 1. **The header.** Identifies the container from bytes the encoder wrote, so a
 *    renamed video or a PDF with an `image/png` MIME is caught before a decoder
 *    is handed anything.
 * 2. **Header and decoder must agree.** A disagreement means one of them was
 *    fooled, and neither answer is then worth acting on.
 * 3. **The decode must complete.** A file can carry a correct signature, sane
 *    dimensions, and still be truncated. See {@link assertDecodesCompletely}.
 *
 * None is redundant. Sharp rasterises SVG happily, so a decode-only rule would
 * accept a scriptable XML document as a picture — the whitelist is what refuses
 * it.
 *
 * 4. **The format must be one the policy allows.** The whitelist above says what
 *    the decoder can read; the policy says what this *type* may be. An animated
 *    GIF is a fine comment image and not a fine avatar, and the difference is
 *    the policy's `allowedFormats`, not the decoder's.
 *
 * **Then, the policy's own budget:** bytes, width, height, total decoded pixels,
 * frame count and playing time. Every policy states all six, so an absent limit
 * cannot silently disable the check it belongs to.
 *
 * ## Why compressed size says nothing about cost
 *
 * A PNG of 6000x6000 flat pixels is 120KB on disk and 36 million pixels in
 * memory; the same trick at 30000x30000 stays under 10MB and asks for nine
 * hundred million. That is what a pixel budget is for — and why a byte limit
 * cannot stand in for one, nor one for the other.
 *
 * The pixel budget in turn guards memory, not CPU. Per-frame work is roughly
 * linear in frame count and nearly independent of frame size, so an animation of
 * thousands of 16x16 frames spends a rounding error of the budget while asking
 * the encoder for thousands of frames of work. The frame and duration caps are
 * what bound that, for the policies that set them.
 *
 * ## Nothing is fully decoded to find out
 *
 * Every Sharp instance here is constructed with `limitInputPixels`. libvips
 * enforces it when the image is *opened*, so `metadata()` on an oversized file
 * throws rather than returning and the pixels are never allocated. The ceiling
 * used to read a header is {@link IMAGE_METADATA_INSPECTION_CEILING} — libvips'
 * own default — which is what lets a rejection name the real dimensions instead
 * of reporting "too big, cannot say how".
 *
 * ## Animation: preserved where the policy says so
 *
 * `ImageService.replaceWithoutExif` opens a GIF with `animated: true`, so every
 * frame is decoded and the stored original keeps moving. That is right for a
 * comment image, a message photo and a setting file, and those policies say
 * `preserveAnimation: true` and allow GIF.
 *
 * The still policies — post photo, post thumbnail, avatar, cover — do not list
 * GIF at all, so an animation is refused as a format rather than silently
 * flattened to its first frame. Refusing is the honest answer: somebody who
 * picked a moving picture for their avatar should be told it will not move, not
 * shown a still they did not choose. `maxFrames: 1` backs it up for the
 * multi-page formats (AVIF/HEIC) that the whitelist does allow.
 */
/**
 * How many full decodes may run at once in this process.
 *
 * `stats()` on a 40-megapixel PNG costs ~530ms wall and ~4.3s of CPU across
 * libvips' threads. One at a time is nothing; twenty TUS transfers finishing
 * together is twenty times the cores, on a box that is also running the API,
 * MongoDB and Redis. Nothing else in the request path bounds this, so it is
 * bounded here.
 */
const IMAGE_VALIDATION_CONCURRENCY = parseInt(process.env.IMAGE_VALIDATION_CONCURRENCY || '3', 10);

/** How long an upload waits for a slot before it is told the server is busy. */
const IMAGE_VALIDATION_QUEUE_TIMEOUT_MS = 60000;

@Injectable()
export class ImageContentValidationService {
  private readonly logger = new Logger(ImageContentValidationService.name);

  /**
   * Shared by every instance on purpose: the resource being protected is this
   * process's CPU, not one injected object's.
   */
  private static readonly limiter = new ConcurrencyLimiter(
    IMAGE_VALIDATION_CONCURRENCY,
    'image validation'
  );

  /** Running and queued counts, for a health endpoint or a log line. */
  public static get pressure(): { running: number; queued: number } {
    return {
      running: ImageContentValidationService.limiter.running,
      queued: ImageContentValidationService.limiter.queued
    };
  }

  /** Read only the header, so an enormous file costs a few bytes to reject. */
  private readHeader(filePath: string): Buffer {
    const handle = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(IMAGE_SNIFF_BYTES);
      const read = fs.readSync(handle, buffer, 0, IMAGE_SNIFF_BYTES, 0);
      return buffer.subarray(0, read);
    } finally {
      fs.closeSync(handle);
    }
  }

  /**
   * Raise one of the policy's three rejections.
   *
   * `reason` is written by this service and is safe to show a caller. Anything
   * a decoder said goes in `detail`, which is **logged and never returned** —
   * "pngload: end of stream" is a fact about libvips, not advice for whoever
   * picked the file, and error text from a third-party library is not something
   * to forward to a client unread.
   */
  private fail(
    code: string,
    policy: ImageUploadPolicy,
    reason: string,
    originalName?: string,
    detail?: string
  ): never {
    const status = policy.statuses[code] || 400;
    this.logger.warn(
      `Rejected upload ${originalName || ''} under ${policy.name}: ${reason} [${code}]`
      + `${detail ? ` — decoder said: ${detail}` : ''}`
    );

    throw new HttpException(
      {
        message: policy.messages[code] || 'That image could not be accepted.',
        error: code,
        statusCode: status,
        reason,
        ...(code === policy.codes.format
          ? { supportedFormats: [...policy.allowedFormats] }
          : { limits: policy.limits })
      },
      status
    );
  }

  /** Not a picture at all: wrong container, corrupt bytes, or a liar. */
  private rejectFormat(
    reason: string,
    policy: ImageUploadPolicy,
    originalName?: string,
    detail?: string
  ): never {
    this.fail(policy.codes.format, policy, reason, originalName, detail);
  }

  /**
   * Too many bytes.
   *
   * Never reached for a resolution problem: a 30000x30000 PNG can be 200KB, and
   * answering that with "save it smaller" would be advice that does not apply.
   */
  private rejectFileSize(reason: string, policy: ImageUploadPolicy, originalName?: string): never {
    this.fail(policy.codes.fileTooLarge, policy, reason, originalName);
  }

  /** Too much picture: width, height, pixels, frames or playing time. */
  private rejectDimensions(reason: string, policy: ImageUploadPolicy, originalName?: string): never {
    this.fail(policy.codes.dimensions, policy, reason, originalName);
  }

  /** Whether a Sharp/libvips failure was the pixel budget rather than bad data. */
  private isPixelLimitError(error: any): boolean {
    return /exceeds pixel limit/i.test(String(error?.message || ''));
  }

  /**
   * Playing time from the decoder's per-frame delays, or `null`.
   *
   * libvips exposes `delay` for GIF and animated WebP and leaves it absent for
   * formats that do not carry one. Only a complete, finite set of delays is
   * trusted: a partial array would understate the duration, and understating it
   * is how a limit gets bypassed. Anything less returns `null`, and the frame
   * count carries the guard on its own.
   */
  private measureDurationMs(metadata: sharp.Metadata, frames: number): number | null {
    const delays = (metadata as any)?.delay;
    if (!Array.isArray(delays) || delays.length !== frames) return null;
    if (!delays.every((delay) => Number.isFinite(delay) && delay >= 0)) return null;
    return delays.reduce((total: number, delay: number) => total + delay, 0);
  }

  /**
   * Confirm the file at `filePath` is a decodable image the policy allows.
   *
   * Throws `HttpException` carrying exactly one of the policy's three codes with
   * the status that belongs to it. Never deletes anything — the caller owns the
   * file and knows what else was created alongside it.
   */
  public async assertDecodableImage(
    filePath: string,
    originalName: string | undefined,
    policy: ImageUploadPolicy
  ): Promise<VerifiedImage> {
    try {
      return await ImageContentValidationService.limiter.run(
        () => this.verify(filePath, originalName, policy),
        IMAGE_VALIDATION_QUEUE_TIMEOUT_MS
      );
    } catch (error: any) {
      // A rejection already carrying a code passes through untouched. Only the
      // gate's own timeout lands here, and it is not the file's fault: 503, so a
      // client retries rather than being told its picture is broken.
      if (error instanceof HttpException) throw error;
      this.logger.warn(`Image validation rejected under backpressure: ${error?.message || error}`);
      throw new HttpException(
        {
          message: 'The server is busy processing uploads. Please try again in a moment.',
          error: 'UPLOAD_VALIDATION_BUSY',
          statusCode: 503
        },
        503
      );
    }
  }

  private async verify(
    filePath: string,
    originalName: string | undefined,
    policy: ImageUploadPolicy
  ): Promise<VerifiedImage> {
    const { limits } = policy;

    if (!filePath || !fs.existsSync(filePath)) {
      this.rejectFormat('the uploaded file is missing', policy, originalName);
    }

    const { size } = fs.statSync(filePath);
    // An empty file has no header to read, and every decoder reports it as a
    // generic failure. Named explicitly so the log says what happened.
    if (!size) this.rejectFormat('the file is empty', policy, originalName);

    // Measured from what arrived, not from the length the request declared.
    // Both are checked: the declared one saves the transfer, this one holds.
    if (size > limits.maxBytes) {
      this.rejectFileSize(
        `the file is ${size} bytes, over the ${limits.maxBytes} byte limit`,
        policy,
        originalName
      );
    }

    const declared = detectImageFormat(this.readHeader(filePath));
    if (!declared) {
      this.rejectFormat('the file header is not a supported raster image', policy, originalName);
    }

    let metadata: sharp.Metadata;
    try {
      // `animated: true` so a multi-frame file reports every page rather than
      // just the first — the frames are what the pipeline decodes, so the frames
      // are what has to be measured.
      //
      // `failOn: 'error'` refuses a picture whose stream is broken beyond what
      // the decoder can recover.
      metadata = await sharp(filePath, {
        animated: true,
        failOn: 'error',
        limitInputPixels: IMAGE_METADATA_INSPECTION_CEILING
      }).metadata();
    } catch (error: any) {
      // Past even the inspection ceiling. Its resolution is the problem, not its
      // format and not its byte count, and the code has to say so.
      if (this.isPixelLimitError(error)) {
        this.rejectDimensions(
          'the image is too large for its header to be read safely',
          policy,
          originalName
        );
      }
      this.rejectFormat(
        'the image header could not be read',
        policy,
        originalName,
        error?.message || String(error)
      );
    }

    const decoded = normaliseDecodedFormat(metadata.format);
    if (!decoded) {
      this.rejectFormat(
        'the decoder reported an unsupported format',
        policy,
        originalName,
        `format=${metadata.format}`
      );
    }

    // The header and the decoder must agree. A disagreement means one of them
    // was fooled, and neither answer is then worth acting on.
    if (decoded !== declared) {
      this.rejectFormat(
        `the header says ${declared} but the decoder says ${decoded}`,
        policy,
        originalName
      );
    }

    // Decodable is not the same as allowed *here*. GIF decodes everywhere, and
    // is a fine comment image and a poor avatar; the policy's list is what
    // separates the two. Checked against the format read from the bytes, never
    // against the declared MIME — the whole point of getting here is that we
    // now know what the file really is.
    if (!policy.allowedFormats.includes(decoded)) {
      this.rejectFormat(
        `${decoded} is not accepted for a ${policy.name} upload`,
        policy,
        originalName
      );
    }

    const frames = Math.max(1, metadata.pages || 1);
    const width = metadata.width || 0;
    // With `animated: true`, `height` is every frame stacked. `pageHeight` is
    // the real one — using `height` would reject a legitimate animation for
    // being as tall as all of its frames put together.
    const height = metadata.pageHeight || metadata.height || 0;

    if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(frames)) {
      this.rejectFormat('the image reports malformed dimensions', policy, originalName);
    }
    if (width <= 0 || height <= 0) {
      this.rejectFormat(
        `the image reports no usable dimensions (${width}x${height})`,
        policy,
        originalName
      );
    }

    if (width > limits.maxWidth) {
      this.rejectDimensions(
        `width ${width}px is over the ${limits.maxWidth}px limit`,
        policy,
        originalName
      );
    }
    if (height > limits.maxHeight) {
      this.rejectDimensions(
        `height ${height}px is over the ${limits.maxHeight}px limit`,
        policy,
        originalName
      );
    }

    // Checked before the pixel budget on purpose: a frame flood is cheap in
    // pixels, so the budget would pass it and the reason for refusing would be
    // the one the reader could not see.
    if (frames > limits.maxFrames) {
      this.rejectDimensions(
        `${frames} frames is over the ${limits.maxFrames} frame limit`,
        policy,
        originalName
      );
    }

    const decodedPixels = width * height * frames;
    if (decodedPixels > limits.maxPixels) {
      this.rejectDimensions(
        `${width}x${height} over ${frames} frame(s) decodes to ${decodedPixels} pixels, `
        + `over the ${limits.maxPixels} pixel budget`,
        policy,
        originalName
      );
    }

    // Only when the decoder gave a delay for every frame. An animation whose
    // delays are unknown is bounded by the frame count above instead.
    const durationMs = this.measureDurationMs(metadata, frames);
    if (durationMs !== null && durationMs > limits.maxDurationMs) {
      this.rejectDimensions(
        `the animation plays for ${durationMs}ms, over the ${limits.maxDurationMs}ms limit`,
        policy,
        originalName
      );
    }

    // Last, because it is the only check that costs a decode — and because it
    // must never run on a file whose size has not already been agreed.
    await this.assertDecodesCompletely(filePath, policy, originalName);

    return {
      format: decoded,
      mimeType: mimeTypeForFormat(decoded),
      width,
      height,
      frames,
      decodedPixels,
      durationMs,
      policy: policy.name
    };
  }

  /**
   * Read the picture through to the end, and refuse it if no picture comes out.
   *
   * ## The contract this implements
   *
   * **An image is accepted only if the processing pipeline can decode all of it.
   * Anything irrecoverably corrupt or truncated is rejected. Recoverable
   * warnings — the ones ordinary photographs carry — do not reject anything.**
   *
   * There is no exception for a particular format. An earlier version of this
   * check accepted truncated JPEGs and said so in the documentation, which was
   * both a strange promise to make and, it turned out, a false one: the file it
   * accepted could not be processed afterwards.
   *
   * ## Why a header is not proof the picture exists
   *
   * `metadata()` reads a header and stops. A file truncated to a third of its
   * length still states a perfectly good 640x480 in its first bytes, so every
   * check above passes and the record is written — and the failure surfaces
   * later, in the processing pipeline, as a row pointing at an image that was
   * never produced.
   *
   * ## Why this is `stats()` and not a small resize
   *
   * The obvious cheap probe — decode into a 32x32 resize — is wrong here, and
   * wrong in the worst way: it *disagrees with the pipeline*. Resizing a JPEG
   * down lets libjpeg scale during the DCT, so it reads a fraction of the
   * scanlines, never reaches the truncation, and reports success. The same file
   * then throws `VipsJpeg: Premature end of input file` the moment
   * `ImageService.replaceWithoutExif` decodes it at full size. A check that
   * passes what the next step rejects is not a cheaper check; it is the thing
   * that produces an accepted record with no renderable image behind it.
   *
   * `stats()` decodes every scanline, exactly as the pipeline does, so its
   * answer is the pipeline's answer. Measured on a 40-megapixel PNG: ~530ms
   * wall, ~4.3s CPU across threads, and **0.7MB of RSS** — libvips streams it
   * rather than materialising the raster, so the memory the pixel budget guards
   * is not touched. The decode that follows this one costs more, because it also
   * encodes.
   *
   * The bound is the policy's own pixel budget where it has one, and libvips'
   * default ceiling where it does not, so this can never become a way around a
   * limit that was already checked.
   *
   * ## Why not `failOn: 'warning'`
   *
   * It would also refuse ordinary photographs. Real files from real phones and
   * browsers routinely warn about harmless things — extraneous bytes before a
   * marker, trailing data after EOI, a non-standard EXIF block — and every one
   * of them decodes to a perfectly good picture. Refusing those to make a
   * "truncated" test read more tidily is a bad trade. The pipeline's own answer
   * is the one that decides: if it can produce a picture, the picture is real.
   */
  private async assertDecodesCompletely(
    filePath: string,
    policy: ImageUploadPolicy,
    originalName?: string
  ): Promise<void> {
    try {
      await sharp(filePath, {
        animated: true,
        failOn: 'error',
        limitInputPixels: policy.limits.maxPixels
      }).stats();
    } catch (error: any) {
      if (this.isPixelLimitError(error)) {
        this.rejectDimensions(
          'the image decodes to more pixels than the budget allows',
          policy,
          originalName
        );
      }
      this.rejectFormat(
        'the image data is incomplete or corrupt',
        policy,
        originalName,
        error?.message || String(error)
      );
    }
  }
}
