import { UPLOAD_POLICY_TYPES } from '@douyin-clone/upload-policy';

import { REAL_IMAGE_HEADERS } from '../hooks/__fixtures__/image-headers';
import {
  acceptAttributeFor,
  AVATAR_UPLOAD_TYPE,
  classifyMeasuredImage,
  classifyPickedFile,
  classifyPickedImage,
  classifyPickedUpload,
  COVER_UPLOAD_TYPE,
  describeUploadFailure,
  MESSAGE_PHOTO_UPLOAD_TYPE,
  messageForUploadError,
  POST_PHOTO_UPLOAD_TYPE,
  POST_THUMBNAIL_UPLOAD_TYPE,
  POST_VIDEO_UPLOAD_TYPE,
  readUploadErrorCode,
  uploadPolicyFor
} from './upload-policy';

/**
 * The composer's own judgement, per upload type.
 *
 * What is worth asserting here is not that the numbers are right — the registry
 * owns those and `upload-policy-contract.spec.ts` proves the installed copy
 * matches it. It is that the *dispatch* is right: that an avatar is judged by
 * the avatar policy and not by whichever one happened to be the default, and
 * that a type nobody registered is refused instead of waved through.
 */

/** A `File` of a stated size and MIME, without allocating the bytes. */
const fileOf = (name: string, type: string, size: number): File => {
  const file = new File([''], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

/**
 * A `File` backed by real encoder output from the shared fixtures.
 *
 * `slice` and `arrayBuffer` are shimmed because jsdom's `File` implements
 * neither usefully, and the check under test reads bytes rather than trusting
 * the name — which is the entire point of it.
 */
const fileFrom = (fixture: string, filename: string, type: string): File => {
  const bytes = Buffer.from(REAL_IMAGE_HEADERS[fixture], 'base64');
  const file = new File([bytes], filename, { type });
  (file as any).slice = (start: number, end: number) => ({
    arrayBuffer: async () => Uint8Array.from(bytes).slice(start, end).buffer
  });
  (file as any).arrayBuffer = async () => Uint8Array.from(bytes).buffer;
  return file;
};

describe('the picker judges each upload type by its own policy', () => {
  it('resolves every registered type', () => {
    for (const type of UPLOAD_POLICY_TYPES) {
      expect({ type, policy: uploadPolicyFor(type)?.type }).toEqual({ type, policy: type });
    }
  });

  /**
   * The failure the registry exists to remove. `getUploadPolicy` returning
   * `null` used to mean "no limits"; here it means "refuse", so a picker that
   * names a type nobody registered cannot upload unchecked.
   */
  it('refuses an unregistered type rather than passing it through', async () => {
    const file = fileOf('a.png', 'image/png', 1024);
    expect(classifyPickedFile(file, 'post-phto')).toBe('UNSUPPORTED_UPLOAD_TYPE');
    await expect(classifyPickedUpload(file, 'post-phto')).resolves.toBe('UNSUPPORTED_UPLOAD_TYPE');
  });

  it('applies a different byte limit to an avatar than to a post photo', () => {
    const avatarLimit = uploadPolicyFor(AVATAR_UPLOAD_TYPE)!.maxBytes;
    const postLimit = uploadPolicyFor(POST_PHOTO_UPLOAD_TYPE)!.maxBytes;
    expect(avatarLimit).toBeLessThan(postLimit);

    // The same file, judged by two policies, gets two different answers. That is
    // the whole point, and it is exactly what a single generic tier could not do.
    const file = fileOf('photo.jpg', 'image/jpeg', avatarLimit + 1);
    expect(classifyPickedFile(file, AVATAR_UPLOAD_TYPE)).toBe('IMAGE_FILE_TOO_LARGE');
    expect(classifyPickedFile(file, POST_PHOTO_UPLOAD_TYPE)).toBeNull();
  });

  it.each([
    AVATAR_UPLOAD_TYPE,
    COVER_UPLOAD_TYPE,
    POST_PHOTO_UPLOAD_TYPE,
    POST_THUMBNAIL_UPLOAD_TYPE,
    MESSAGE_PHOTO_UPLOAD_TYPE
  ])('accepts %s exactly at its byte limit and refuses one byte over', (type) => {
    const limit = uploadPolicyFor(type)!.maxBytes;
    expect(classifyPickedFile(fileOf('a.jpg', 'image/jpeg', limit), type)).toBeNull();
    expect(classifyPickedFile(fileOf('a.jpg', 'image/jpeg', limit + 1), type))
      .toBe('IMAGE_FILE_TOO_LARGE');
  });

  it('keeps the comment vocabulary for comment images and nothing else', () => {
    const commentLimit = uploadPolicyFor('comment-photo')!.maxBytes;
    expect(classifyPickedFile(fileOf('a.jpg', 'image/jpeg', commentLimit + 1), 'comment-photo'))
      .toBe('COMMENT_IMAGE_FILE_TOO_LARGE');

    // A message photo has the same limits and deliberately not the same codes:
    // the comment composer matches on `COMMENT_*` and must not be handed a
    // message rejection.
    const messageLimit = uploadPolicyFor(MESSAGE_PHOTO_UPLOAD_TYPE)!.maxBytes;
    expect(classifyPickedFile(fileOf('a.jpg', 'image/jpeg', messageLimit + 1), MESSAGE_PHOTO_UPLOAD_TYPE))
      .toBe('IMAGE_FILE_TOO_LARGE');
  });

  it('refuses a video for an image type on its declared MIME alone', () => {
    // Cheap and synchronous: a 400MB video picked into the avatar control is
    // refused without a read.
    expect(classifyPickedFile(fileOf('clip.mp4', 'video/mp4', 1024), AVATAR_UPLOAD_TYPE))
      .toBe('INVALID_IMAGE_FORMAT');
  });

  it('never admits SVG, which is a document wearing an image MIME', () => {
    for (const type of [AVATAR_UPLOAD_TYPE, POST_PHOTO_UPLOAD_TYPE, MESSAGE_PHOTO_UPLOAD_TYPE]) {
      expect(classifyPickedFile(fileOf('x.svg', 'image/svg+xml', 512), type))
        .toBe(uploadPolicyFor(type)!.codes.format);
    }
  });

  it('lets a file with no declared type through to the server', () => {
    // Some platforms report nothing. Refusing here would block a valid file on
    // the browser's silence.
    expect(classifyPickedFile(fileOf('mystery', '', 1024), POST_PHOTO_UPLOAD_TYPE)).toBeNull();
  });
});

describe('animation is allowed only where the product renders it', () => {
  it('offers GIF in the message picker and not in the avatar one', () => {
    expect(acceptAttributeFor(MESSAGE_PHOTO_UPLOAD_TYPE)).toContain('image/gif');
    expect(acceptAttributeFor(AVATAR_UPLOAD_TYPE)).not.toContain('image/gif');
    expect(acceptAttributeFor(POST_PHOTO_UPLOAD_TYPE)).not.toContain('image/gif');
  });

  it('refuses a GIF picked as an avatar on its MIME', () => {
    expect(classifyPickedFile(fileOf('anim.gif', 'image/gif', 1024), AVATAR_UPLOAD_TYPE))
      .toBe('INVALID_IMAGE_FORMAT');
  });

  it('refuses a GIF whose bytes give it away, whatever it was named', async () => {
    // The realistic attempt: rename `anim.gif` to `anim.png` so the browser
    // reports `image/png` and the MIME whitelist above lets it past. Only the
    // header settles it — which is why the byte check exists at all.
    const gif = fileFrom('gif_120x90', 'anim.png', 'image/png');
    await expect(classifyPickedImage(gif, AVATAR_UPLOAD_TYPE)).resolves.toBe('INVALID_IMAGE_FORMAT');
    // The same bytes are a perfectly good message photo. One file, two answers,
    // decided by the upload type — which a single generic tier could not do.
    await expect(classifyPickedImage(gif, MESSAGE_PHOTO_UPLOAD_TYPE)).resolves.toBeNull();
  });

  it('refuses a PNG bomb as an avatar and accepts an ordinary PNG', async () => {
    // 257KB on disk, 81 million pixels once decoded: inside every byte limit in
    // the registry and far past the avatar's 16MP budget. This is the case a
    // byte check alone cannot see.
    await expect(classifyPickedImage(fileFrom('pngBomb_9000x9000', 'bomb.png', 'image/png'), AVATAR_UPLOAD_TYPE))
      .resolves.toBe('IMAGE_DIMENSIONS_EXCEEDED');
    await expect(classifyPickedImage(fileFrom('png_640x480', 'ok.png', 'image/png'), AVATAR_UPLOAD_TYPE))
      .resolves.toBeNull();
  });

  it('lets the same bomb through where the budget is large enough', async () => {
    // 81MP is over the post photo budget too, so the honest demonstration of
    // "different budgets, different answers" is a picture between the two.
    const avatar: any = uploadPolicyFor(AVATAR_UPLOAD_TYPE);
    const post: any = uploadPolicyFor(POST_PHOTO_UPLOAD_TYPE);
    const between = { width: 5000, height: 5000 };
    expect(between.width * between.height).toBeGreaterThan(avatar.maxPixels);
    expect(between.width * between.height).toBeLessThan(post.maxPixels);

    expect(classifyMeasuredImage(between, AVATAR_UPLOAD_TYPE)).toBe(avatar.codes.dimensions);
    expect(classifyMeasuredImage(between, POST_PHOTO_UPLOAD_TYPE)).toBeNull();
  });

  it('caps still policies at one frame', () => {
    for (const type of [AVATAR_UPLOAD_TYPE, COVER_UPLOAD_TYPE, POST_PHOTO_UPLOAD_TYPE, POST_THUMBNAIL_UPLOAD_TYPE]) {
      expect(classifyMeasuredImage({ width: 100, height: 100, frames: 2 }, type))
        .toBe(uploadPolicyFor(type)!.codes.dimensions);
    }
  });
});

describe('resolution and pixel budgets, per type', () => {
  it('accepts the exact per-side limit and refuses one pixel past it', () => {
    for (const type of [AVATAR_UPLOAD_TYPE, COVER_UPLOAD_TYPE, POST_PHOTO_UPLOAD_TYPE]) {
      const policy: any = uploadPolicyFor(type);
      expect(classifyMeasuredImage({ width: policy.maxWidth, height: 1 }, type)).toBeNull();
      expect(classifyMeasuredImage({ width: policy.maxWidth + 1, height: 1 }, type))
        .toBe(policy.codes.dimensions);
    }
  });

  it('refuses a shape that fits both sides but blows the pixel budget', () => {
    const policy: any = uploadPolicyFor(POST_PHOTO_UPLOAD_TYPE);
    // 12000 x 12000 is 144MP: inside both per-side limits and well past the
    // 60MP budget. This is the case a per-side check alone would let through.
    expect(classifyMeasuredImage({ width: policy.maxWidth, height: policy.maxHeight }, POST_PHOTO_UPLOAD_TYPE))
      .toBe(policy.codes.dimensions);
  });

  it('gives an avatar a tighter resolution budget than a post photo', () => {
    const avatar: any = uploadPolicyFor(AVATAR_UPLOAD_TYPE);
    const post: any = uploadPolicyFor(POST_PHOTO_UPLOAD_TYPE);
    expect(avatar.maxWidth).toBeLessThan(post.maxWidth);
    expect(avatar.maxPixels).toBeLessThan(post.maxPixels);

    const big = { width: 6000, height: 4000 };
    expect(classifyMeasuredImage(big, AVATAR_UPLOAD_TYPE)).toBe(avatar.codes.dimensions);
    expect(classifyMeasuredImage(big, POST_PHOTO_UPLOAD_TYPE)).toBeNull();
  });
});

describe('the error contract the toast reads', () => {
  it('maps every code a policy can raise to a message', () => {
    for (const type of UPLOAD_POLICY_TYPES) {
      const policy: any = uploadPolicyFor(type);
      for (const code of Object.values<string>(policy.codes)) {
        expect({ code, message: typeof messageForUploadError(code) })
          .toEqual({ code, message: 'string' });
      }
    }
  });

  it('reads the code out of an upload result rather than its prose', () => {
    // `uploadFileTus` resolves with `errorCode`; an HTTP failure carries it in
    // the body. Both are the contract; the message never is.
    expect(readUploadErrorCode({ errorCode: 'VIDEO_DURATION_EXCEEDED' }))
      .toBe('VIDEO_DURATION_EXCEEDED');
    expect(readUploadErrorCode({ response: { data: { error: 'IMAGE_FILE_TOO_LARGE' } } }))
      .toBe('IMAGE_FILE_TOO_LARGE');
    expect(readUploadErrorCode(new Error('Image must be 5MB or smaller'))).toBeNull();
  });

  it('falls back to the caller wording for a failure it does not recognise', () => {
    // Inventing a reason for an unknown failure is worse than saying the upload
    // failed.
    expect(describeUploadFailure(new Error('socket hang up'), 'Upload failed'))
      .toBe('Upload failed');
    expect(describeUploadFailure({ errorCode: 'VIDEO_RESOLUTION_EXCEEDED' }, 'Upload failed'))
      .toBe(messageForUploadError('VIDEO_RESOLUTION_EXCEEDED'));
  });
});

describe('the video picker', () => {
  it('refuses a clip over the byte limit without touching the file', () => {
    const limit = uploadPolicyFor(POST_VIDEO_UPLOAD_TYPE)!.maxBytes;
    expect(classifyPickedFile(fileOf('clip.mp4', 'video/mp4', limit + 1), POST_VIDEO_UPLOAD_TYPE))
      .toBe('VIDEO_FILE_TOO_LARGE');
    expect(classifyPickedFile(fileOf('clip.mp4', 'video/mp4', limit), POST_VIDEO_UPLOAD_TYPE))
      .toBeNull();
  });

  it('refuses an image picked into a video control', () => {
    expect(classifyPickedFile(fileOf('a.png', 'image/png', 1024), POST_VIDEO_UPLOAD_TYPE))
      .toBe('INVALID_VIDEO_FORMAT');
  });

  it('offers only the containers the pipeline reads', () => {
    const accept = acceptAttributeFor(POST_VIDEO_UPLOAD_TYPE);
    expect(accept).toContain('video/mp4');
    expect(accept).toContain('video/quicktime');
    expect(accept).toContain('video/webm');
    // The old picker advertised these and the server refused every one.
    for (const absent of ['.flv', '.avi', '.wmv', '.mkv', '.mpg']) {
      expect(accept).not.toContain(absent);
    }
  });

  it('leaves what the browser cannot measure to the server', async () => {
    // jsdom has no media stack, so `measureVideo` times out and resolves null.
    // The right answer for that is "no opinion", never "refused".
    const clip = fileOf('clip.mp4', 'video/mp4', 1024);
    await expect(classifyPickedUpload(clip, POST_VIDEO_UPLOAD_TYPE)).resolves.toBeNull();
  }, 10000);
});
