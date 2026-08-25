import * as installed from '@douyin-clone/upload-policy';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The upload policy the web app compiles against must be the one in the repo.
 *
 * ## The failure this exists to catch
 *
 * `@douyin-clone/upload-policy` is wired as `file:../shared/upload-policy`, and
 * **Yarn v1 copies rather than links a `file:` dependency**. Editing the shared
 * package does not reach the apps: `yarn install`, and even
 * `yarn install --check-files`, report "already up-to-date" and skip the
 * re-copy. So the client can go on enforcing last week's limits while the file
 * server enforces this week's, and nothing about that is visible — the build
 * passes, the types line up, and only a rejected upload with a confusing message
 * ever hints at it.
 *
 * That is the same trap `shared/toast` documents in `.agents/rules/shared.md`.
 * The fix when this test fails:
 *
 * ```
 * rm -rf node_modules/@douyin-clone/upload-policy
 * yarn install --force
 * ```
 *
 * ## Why this is a comparison and not a list of expected numbers
 *
 * Hard-coding the values here would make this a second copy of the policy —
 * exactly the thing the shared package removed. It compares the installed module
 * against the file in the repository instead, so it has an opinion about
 * *agreement* and none at all about what the numbers should be.
 */
describe('the installed upload policy matches the repository', () => {
  const sourcePath = path.resolve(__dirname, '../../../shared/upload-policy/index.js');

  it('is actually reading the shared package from the repo', () => {
    expect(fs.existsSync(sourcePath)).toBe(true);
  });

  /**
   * The named exports, without the interop `default`.
   *
   * The package is CommonJS and the app compiles ESM, so the interop layer adds
   * a `default` binding that the source file never declared. Comparing it would
   * be comparing the module system rather than the policy.
   */
  const namedExports = (module_: object) => Object.keys(module_).filter((key) => key !== 'default').sort();

  it('exports exactly what the source exports', () => {
    const source = require(sourcePath);
    expect(namedExports(installed)).toEqual(namedExports(source));
  });

  it('carries identical values, so the client cannot enforce a stale limit', () => {
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

  it('keeps every limit a finite positive number', () => {
    // A limit that arrives as `undefined` compares as greater than nothing and
    // silently disables the check it belongs to.
    const limits = [
      installed.MAX_COMMENT_IMAGE_BYTES,
      installed.MAX_COMMENT_IMAGE_WIDTH,
      installed.MAX_COMMENT_IMAGE_HEIGHT,
      installed.MAX_COMMENT_IMAGE_PIXELS,
      installed.MAX_COMMENT_IMAGE_FRAMES,
      installed.MAX_COMMENT_IMAGE_DURATION_MS
    ];
    for (const limit of limits) {
      expect(Number.isFinite(limit)).toBe(true);
      expect(limit).toBeGreaterThan(0);
    }
  });

  it('names a status and a message for every code', () => {
    for (const code of Object.values(installed.COMMENT_IMAGE_ERROR_CODES)) {
      expect(installed.COMMENT_IMAGE_ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
      expect(typeof installed.COMMENT_IMAGE_ERROR_MESSAGES[code]).toBe('string');
    }
  });
});
