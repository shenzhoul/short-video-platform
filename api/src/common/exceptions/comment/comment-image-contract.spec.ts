import * as fs from 'fs';
import * as path from 'path';

import * as installed from '@douyin-clone/upload-policy';

import {
  COMMENT_IMAGE_DIMENSIONS_EXCEEDED,
  COMMENT_IMAGE_FILE_TOO_LARGE,
  CommentImageFileTooLargeException,
  CommentImageTooLargeException,
  INVALID_COMMENT_IMAGE_FORMAT,
  InvalidCommentImageException
} from './invalid-comment-image.exception';

/**
 * The API's half of the comment-image error contract.
 *
 * Three refusals, three codes, three statuses. A client matches on the code
 * alone, so what matters is that each exception carries the code and status the
 * shared policy names — and that nothing collapses two of them into one.
 *
 * The second half of this file guards against a subtler failure:
 * `@douyin-clone/upload-policy` is wired as `file:../shared/upload-policy`, and
 * Yarn v1 *copies* rather than links such a dependency. A change to the shared
 * package does not reach this app until the copy is deleted and reinstalled, so
 * the API can go on enforcing a limit the file server has already moved. That
 * drift is invisible: the build passes and the types agree.
 *
 * When the comparison below fails:
 *
 * ```
 * rm -rf node_modules/@douyin-clone/upload-policy
 * yarn install --force
 * ```
 */
describe('the comment image error contract', () => {
  /** The stable code, read from the body a client would actually receive. */
  const codeOf = (error: { getResponse: () => any }): string => error.getResponse()?.error;

  it('gives a byte-count rejection its own code and a 413', () => {
    const error = new CommentImageFileTooLargeException('too many bytes');
    expect(codeOf(error)).toBe(COMMENT_IMAGE_FILE_TOO_LARGE);
    expect(codeOf(error)).toBe('COMMENT_IMAGE_FILE_TOO_LARGE');
    expect(error.getStatus()).toBe(413);
  });

  it('gives a resolution rejection a different code', () => {
    const error = new CommentImageTooLargeException('too many pixels');
    expect(codeOf(error)).toBe(COMMENT_IMAGE_DIMENSIONS_EXCEEDED);
    expect(error.getStatus()).toBe(400);
  });

  it('gives a format rejection a third code', () => {
    const error = new InvalidCommentImageException('not a picture');
    expect(codeOf(error)).toBe(INVALID_COMMENT_IMAGE_FORMAT);
    expect(error.getStatus()).toBe(400);
  });

  it('never lets a file-size rejection be reported as a dimensions one', () => {
    // The regression this split exists to prevent: a 10MB photograph is not a
    // resolution problem, and telling its author to use a smaller picture is
    // advice that does not apply.
    const bytes = new CommentImageFileTooLargeException();
    const pixels = new CommentImageTooLargeException();
    expect(codeOf(bytes)).not.toBe(codeOf(pixels));
    expect(bytes.getStatus()).not.toBe(pixels.getStatus());
  });

  it('uses three distinct codes in total', () => {
    const codes = [
      codeOf(new InvalidCommentImageException()),
      codeOf(new CommentImageFileTooLargeException()),
      codeOf(new CommentImageTooLargeException())
    ];
    expect(new Set(codes).size).toBe(3);
  });
});

/**
 * The generic tier's half of the contract.
 *
 * Comment limits apply to `comment-photo` uploads and to nothing else. A post
 * photo, a message photo, an avatar or a cover is still checked for being a real
 * image, and is answered in its own vocabulary — because the client that matches
 * `COMMENT_*` is the comment composer asking about comment rules, and a post
 * upload has not broken any of them.
 *
 * The dispatch itself lives in the file server (`upload-policy.ts`) and is
 * exercised by `file-server/scripts/verify-upload-policies.js`, which has the
 * real Sharp and the real FFmpeg. What is asserted here is the part both
 * services share: that the vocabularies exist, stay distinct, and carry a status
 * apiece.
 */
describe('the generic image error contract', () => {
  it('is a separate set of codes from the comment one', () => {
    const generic = Object.values(installed.IMAGE_ERROR_CODES);
    const comment = Object.values(installed.COMMENT_IMAGE_ERROR_CODES);

    expect(generic).toHaveLength(3);
    expect(comment).toHaveLength(3);
    for (const code of generic) {
      expect(comment).not.toContain(code);
    }
    expect(new Set([...generic, ...comment]).size).toBe(6);
  });

  it('never answers a non-comment upload in comment vocabulary', () => {
    // The scope regression this split undoes: the comment limits were briefly
    // the validator's default, so every image upload inherited both the rules
    // and the codes.
    for (const code of Object.values(installed.IMAGE_ERROR_CODES)) {
      expect(code.startsWith('COMMENT_')).toBe(false);
      expect(code).not.toBe(installed.INVALID_COMMENT_IMAGE_FORMAT);
    }
  });

  it('names a status and a message for every generic code', () => {
    for (const code of Object.values(installed.IMAGE_ERROR_CODES)) {
      expect(installed.IMAGE_ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
      expect(typeof installed.IMAGE_ERROR_MESSAGES[code]).toBe('string');
      expect(installed.IMAGE_ERROR_MESSAGES[code].length).toBeGreaterThan(0);
    }
    // 413 stays the byte-count status in both tiers.
    expect(installed.IMAGE_ERROR_STATUS.IMAGE_FILE_TOO_LARGE).toBe(413);
  });

  it('names the one upload type the comment limits belong to', () => {
    // The dispatch key, shared so the file server and this API cannot disagree
    // about which uploads are comment images.
    expect(installed.COMMENT_IMAGE_UPLOAD_TYPE).toBe('comment-photo');
  });
});

describe('the installed upload policy matches the repository', () => {
  const sourcePath = path.resolve(__dirname, '../../../../../shared/upload-policy/index.js');

  it('is actually reading the shared package from the repo', () => {
    expect(fs.existsSync(sourcePath)).toBe(true);
  });

  it('exports exactly what the source exports', () => {
    const source = require(sourcePath);
    // Without the interop `default` the CommonJS/ESM bridge adds, which is the
    // module system rather than the policy.
    const named = (module_: object) => Object.keys(module_).filter((key) => key !== 'default').sort();
    expect(named(installed)).toEqual(named(source));
  });

  it('carries identical values, so the API cannot enforce a stale limit', () => {
    const source = require(sourcePath);
    for (const key of Object.keys(source)) {
      // The registry exports functions as well as data now, and a function
      // cannot be value-compared here: `toEqual` compares by reference and
      // reports "serializes to the same string", while comparing source text
      // fails whenever a bundler re-indents the copy — which SWC does. So a
      // function is only checked for still being one, and the test below
      // compares what the two copies actually *answer*, which is what a caller
      // depends on anyway.
      if (typeof source[key] === 'function') {
        expect({ [key]: typeof (installed as any)[key] }).toEqual({ [key]: 'function' });
        continue;
      }
      expect({ [key]: (installed as any)[key] }).toEqual({ [key]: source[key] });
    }
  });

  /**
   * The comparison above proves the two modules hold the same bytes. This proves
   * they give the same answers, which is what a caller actually depends on: a
   * lookup table can match while the function reading it does not.
   */
  it('resolves every registered type to the same policy in both copies', () => {
    const source = require(sourcePath);
    expect(installed.UPLOAD_POLICY_TYPES).toEqual(source.UPLOAD_POLICY_TYPES);

    for (const type of source.UPLOAD_POLICY_TYPES) {
      expect({ type, policy: installed.getUploadPolicy(type) })
        .toEqual({ type, policy: source.getUploadPolicy(type) });
    }

    // And both fail closed on the same input.
    expect(installed.getUploadPolicy('post-phto')).toBeNull();
    expect(source.getUploadPolicy('post-phto')).toBeNull();
  });
});
