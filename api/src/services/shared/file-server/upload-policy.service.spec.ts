import * as uploadPolicy from '@douyin-clone/upload-policy';
import {
  getUploadPolicy,
  UPLOAD_HARD_CEILINGS,
  UPLOAD_POLICY_TYPES,
  uploadLimitSettingKey,
  validateUploadLimitSetting
} from '@douyin-clone/upload-policy';

import { UploadPolicyService } from './upload-policy.service';

/**
 * The API's half of the per-type upload contract.
 *
 * Two questions, and they are different:
 *
 *  - **Does every durable type resolve to the policy it should?** A registry
 *    whose lookup is subtly wrong is worse than no registry, because every
 *    caller believes a limit is being applied.
 *  - **Does an unknown type fail closed?** This is the one that used to go the
 *    other way: everything that was not `comment-photo` fell into a tier with no
 *    byte, pixel, frame or duration limit at all, so a typo in a controller was
 *    indistinguishable from a deliberate choice.
 */
/**
 * A stand-in for the settings cache.
 *
 * `SettingService` reads from a static in-memory map that is filled from Mongo
 * and refreshed over Redis pub/sub. None of that is what these tests are about —
 * what matters is the shape of the answer, so the fake returns exactly what
 * `getPublicValueByKeys` returns: the requested keys, with `undefined` for the
 * ones that are not stored.
 */
const settingsStub = (stored: Record<string, any> = {}) => ({
  getPublicValueByKeys: (keys: string[]) => keys.reduce((out, key) => {
    // eslint-disable-next-line no-param-reassign
    out[key] = stored[key];
    return out;
  }, {} as Record<string, any>)
});

const serviceWith = (stored: Record<string, any> = {}) => {
  const service = new UploadPolicyService(settingsStub(stored) as any);
  jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
  jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  return service;
};

describe('UploadPolicyService', () => {
  let service: UploadPolicyService;

  beforeEach(() => {
    // No stored settings: a blank database, which must behave exactly as the
    // registry defaults say.
    service = serviceWith();
  });

  describe('policy resolution', () => {
    it.each(UPLOAD_POLICY_TYPES)('resolves %s to its own policy', (type) => {
      const policy = service.assertPublicUpload(type);
      expect(policy.type).toBe(type);
    });

    it('gives every type a complete budget, so no check is silently disabled', () => {
      for (const type of UPLOAD_POLICY_TYPES) {
        const policy: any = service.policyFor(type);
        // An absent limit compares as "greater than nothing" at every call site.
        const axes = policy.mediaKind === 'image'
          ? ['maxBytes', 'maxWidth', 'maxHeight', 'maxPixels', 'maxFrames', 'maxDurationMs']
          : ['maxBytes', 'maxWidth', 'maxHeight', 'maxDurationMs', 'maxFrameRate', 'maxVideoBitrate'];

        for (const axis of axes) {
          expect({ type, axis, value: policy[axis] })
            .toEqual({ type, axis, value: expect.any(Number) });
          expect(Number.isFinite(policy[axis])).toBe(true);
          expect(policy[axis]).toBeGreaterThan(0);
        }
      }
    });

    it('names a status and a message for every code a policy can raise', () => {
      for (const type of UPLOAD_POLICY_TYPES) {
        const policy: any = service.policyFor(type);
        for (const code of Object.values<string>(policy.codes)) {
          expect(policy.statuses[code]).toBeGreaterThanOrEqual(400);
          expect(typeof policy.messages[code]).toBe('string');
          expect(policy.messages[code].length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('failing closed', () => {
    it('answers an unknown type with UNSUPPORTED_UPLOAD_TYPE', () => {
      try {
        service.assertPublicUpload('not-a-real-type');
        throw new Error('expected a refusal');
      } catch (error: any) {
        expect(error.getResponse().error).toBe('UNSUPPORTED_UPLOAD_TYPE');
        expect(error.getStatus()).toBe(400);
      }
    });

    /**
     * The specific regression the registry exists to prevent. `post-phto` used
     * to resolve to the generic tier, which set no limits — so a one-character
     * typo turned a 20MB/60MP policy into no policy, silently, and the upload
     * still succeeded.
     */
    it('does not let a typo fall into a wider policy than the type it misspells', () => {
      expect(getUploadPolicy('post-phto')).toBeNull();
      expect(() => service.assertPublicUpload('post-phto')).toThrow();

      // And the correctly spelled one is genuinely narrower than "no limits".
      const real: any = service.assertPublicUpload('post-photo');
      expect(real.maxBytes).toBeLessThan(Number.MAX_SAFE_INTEGER);
      expect(real.maxPixels).toBeLessThan(Number.MAX_SAFE_INTEGER);
    });

    /**
     * No registered type is internal-only today, so the flag is exercised by
     * making one. Without this the branch could be deleted or inverted and
     * nothing would notice until the first server-generated derivative was
     * added — at which point a client could ask for an upload URL for it.
     */
    it('refuses a public upload URL for a policy marked internal-only', () => {
      const internalOnly = {
        ...(service.policyFor('post-thumbnail') as any),
        publicUpload: false
      };
      // `resolveEffectiveUploadPolicy` is what the upload path calls now — it is
      // the one that applies admin overrides — so that is what has to be stubbed.
      // Spying on `getUploadPolicy` would leave the real resolver in place and
      // the test would pass for the wrong reason, or fail for a confusing one.
      const lookup = jest.spyOn(uploadPolicy, 'resolveEffectiveUploadPolicy')
        .mockReturnValue(internalOnly);

      try {
        service.assertPublicUpload('post-thumbnail');
        throw new Error('expected a refusal');
      } catch (error: any) {
        expect(error.getResponse().error).toBe('UNSUPPORTED_UPLOAD_TYPE');
        expect(error.getStatus()).toBe(400);
      } finally {
        lookup.mockRestore();
      }
    });
  });

  describe('the declared-size courtesy', () => {
    it('refuses a declared size over the type limit with the byte code', () => {
      const policy: any = service.policyFor('avatar');
      try {
        service.assertPublicUpload('avatar', policy.maxBytes + 1);
        throw new Error('expected a refusal');
      } catch (error: any) {
        expect(error.getResponse().error).toBe('IMAGE_FILE_TOO_LARGE');
        // 413 belongs to the byte limit and to nothing else.
        expect(error.getStatus()).toBe(413);
      }
    });

    it('accepts a declared size exactly at the limit', () => {
      const policy: any = service.policyFor('avatar');
      expect(() => service.assertPublicUpload('avatar', policy.maxBytes)).not.toThrow();
    });

    it('keeps the comment vocabulary for comment images', () => {
      const policy: any = service.policyFor('comment-photo');
      try {
        service.assertPublicUpload('comment-photo', policy.maxBytes + 1);
        throw new Error('expected a refusal');
      } catch (error: any) {
        // The composer matches on this exact code. Answering with the generic
        // one would silently break the three-message mapping it relies on.
        expect(error.getResponse().error).toBe('COMMENT_IMAGE_FILE_TOO_LARGE');
        expect(error.getStatus()).toBe(413);
      }
    });

    it('uses the video vocabulary for videos', () => {
      const policy: any = service.policyFor('post-video');
      try {
        service.assertPublicUpload('post-video', policy.maxBytes + 1);
        throw new Error('expected a refusal');
      } catch (error: any) {
        expect(error.getResponse().error).toBe('VIDEO_FILE_TOO_LARGE');
        expect(error.getStatus()).toBe(413);
      }
    });

    it('lets a missing or nonsensical declared size through to the file server', () => {
      // A claim that is absent is not a claim of zero. The bytes that arrive
      // settle it, and refusing here on a missing field would break every client
      // that does not send one.
      expect(() => service.assertPublicUpload('post-photo')).not.toThrow();
      expect(() => service.assertPublicUpload('post-photo', undefined)).not.toThrow();
      expect(() => service.assertPublicUpload('post-photo', Number.NaN)).not.toThrow();
    });
  });

  describe('the limits themselves', () => {
    /**
     * These are the numbers the report and the docs quote. Asserted so that a
     * later edit to the registry has to be a deliberate one, and so the three
     * enforcement points cannot be described as agreeing when they do not.
     */
    it('holds the per-type byte limits the product documents', () => {
      const bytes = (type: string) => (service.policyFor(type) as any).maxBytes / (1024 * 1024);
      expect(bytes('comment-photo')).toBe(10);
      expect(bytes('message-photo')).toBe(10);
      expect(bytes('post-photo')).toBe(20);
      expect(bytes('post-thumbnail')).toBe(5);
      expect(bytes('avatar')).toBe(5);
      expect(bytes('cover')).toBe(10);
      expect(bytes('setting-file')).toBe(10);
      expect(bytes('post-video')).toBe(500);
      expect(bytes('post-teaser')).toBe(200);
      expect(bytes('message-video')).toBe(200);
    });

    it('keeps animation only where the product actually renders it', () => {
      const animated = UPLOAD_POLICY_TYPES
        .filter((type) => (service.policyFor(type) as any).mediaKind === 'image')
        .filter((type) => (service.policyFor(type) as any).preserveAnimation);

      // A moving avatar or a moving post photo is not something the product
      // renders, so those policies do not list GIF and cap frames at one.
      expect(animated.sort()).toEqual(['comment-photo', 'message-photo', 'setting-file']);

      for (const type of ['post-photo', 'post-thumbnail', 'avatar', 'cover']) {
        const policy: any = service.policyFor(type);
        expect(policy.allowedFormats).not.toContain('gif');
        expect(policy.maxFrames).toBe(1);
      }
    });

    it('never widens the teaser limits to match the main video', () => {
      const teaser: any = service.policyFor('post-teaser');
      const video: any = service.policyFor('post-video');
      // The composer already refused above 200MB and 60 seconds. Relaxing that
      // to match post-video would be loosening an existing limit for no reason.
      expect(teaser.maxBytes).toBeLessThan(video.maxBytes);
      expect(teaser.maxDurationMs).toBeLessThan(video.maxDurationMs);
      expect(teaser.maxDurationMs).toBe(60 * 1000);
    });
  });
});


/**
 * The limits an operator can move, and the ones they cannot.
 *
 * Every assertion here is about the *seam*: a stored setting becomes an
 * effective policy, an unusable one does not, and nothing can push a number past
 * the point where it stops being a policy and becomes a way to exhaust the
 * machine.
 */
describe('admin-adjustable upload limits', () => {
  const key = (type: string, suffix: string) => uploadLimitSettingKey(type, suffix);

  describe('a blank database', () => {
    it('uses the registry defaults for every type', () => {
      const service = serviceWith();
      for (const type of UPLOAD_POLICY_TYPES) {
        expect({ type, effective: service.effectivePolicy(type) })
          .toEqual({ type, effective: service.defaultPolicyFor(type) });
      }
    });

    it('needs no setting rows to exist at all', () => {
      // The migration makes the numbers visible and editable. It is not what
      // makes them work — this is the assertion that says so.
      const service = serviceWith();
      expect(service.effectivePolicy('avatar')!.maxBytes).toBe(5 * 1024 * 1024);
      expect(service.effectivePolicy('post-video')!.maxDurationMs).toBe(10 * 60 * 1000);
    });
  });

  describe('an override', () => {
    it('raises a limit without touching the others', () => {
      const service = serviceWith({ [key('avatar', 'maxFileSizeMb')]: 12 });
      const policy: any = service.effectivePolicy('avatar');
      const original: any = service.defaultPolicyFor('avatar');

      expect(policy.maxBytes).toBe(12 * 1024 * 1024);
      expect(policy.maxWidth).toBe(original.maxWidth);
      expect(policy.maxPixels).toBe(original.maxPixels);
      expect(policy.maxFrames).toBe(original.maxFrames);
    });

    it('lowers one too', () => {
      const service = serviceWith({ [key('post-photo', 'maxFileSizeMb')]: 4 });
      expect(service.effectivePolicy('post-photo')!.maxBytes).toBe(4 * 1024 * 1024);
    });

    it('converts the operator units the form uses', () => {
      const service = serviceWith({
        [key('post-video', 'maxDurationSeconds')]: 90,
        [key('comment-photo', 'maxAnimationSeconds')]: 12,
        [key('cover', 'maxPixelsMp')]: 25
      });
      expect((service.effectivePolicy('post-video') as any).maxDurationMs).toBe(90000);
      expect((service.effectivePolicy('comment-photo') as any).maxDurationMs).toBe(12000);
      expect((service.effectivePolicy('cover') as any).maxPixels).toBe(25000000);
    });

    it('only affects the type it names', () => {
      const service = serviceWith({ [key('avatar', 'maxFileSizeMb')]: 90 });
      expect(service.effectivePolicy('avatar')!.maxBytes).toBe(90 * 1024 * 1024);
      expect(service.effectivePolicy('cover')!.maxBytes)
        .toBe(service.defaultPolicyFor('cover')!.maxBytes);
    });

    it('is what assertPublicUpload judges a declared size against', () => {
      // The whole point: raising the setting has to change what is accepted, not
      // just what a getter reports.
      const raised = serviceWith({ [key('avatar', 'maxFileSizeMb')]: 20 });
      expect(() => raised.assertPublicUpload('avatar', 15 * 1024 * 1024)).not.toThrow();

      const lowered = serviceWith({ [key('avatar', 'maxFileSizeMb')]: 2 });
      expect(() => lowered.assertPublicUpload('avatar', 3 * 1024 * 1024)).toThrow();
    });
  });

  describe('the hard ceiling', () => {
    it('clamps a stored value that is past it', () => {
      const service = serviceWith({ [key('avatar', 'maxFileSizeMb')]: 100000 });
      expect(service.effectivePolicy('avatar')!.maxBytes).toBe(UPLOAD_HARD_CEILINGS.image.maxBytes);
    });

    it('refuses to store one in the first place', () => {
      const problem = validateUploadLimitSetting(key('avatar', 'maxFileSizeMb'), 100000);
      expect(problem).toMatch(/hard limit/i);
      expect(problem).toContain('100MB');
    });

    it('sits above every default, so nothing ships already clamped', () => {
      const service = serviceWith();
      for (const type of UPLOAD_POLICY_TYPES) {
        const policy: any = service.defaultPolicyFor(type);
        const ceilings: any = (UPLOAD_HARD_CEILINGS as any)[policy.mediaKind];
        for (const field of Object.keys(ceilings)) {
          expect({ type, field, withinCeiling: policy[field] <= ceilings[field] })
            .toEqual({ type, field, withinCeiling: true });
        }
      }
    });

    it('keeps the image pixel ceiling below what libvips will open', () => {
      // The metadata read uses libvips' own 0x3fff^2 ceiling. A configurable
      // budget above that could never be reached: the header read would throw
      // first and report a resolution problem for a file that was inside the
      // configured limit.
      expect(UPLOAD_HARD_CEILINGS.image.maxPixels).toBeLessThan(0x3fff * 0x3fff);
    });
  });

  describe('a broken setting', () => {
    it.each([
      ['a string that is not a number', 'twenty'],
      ['zero', 0],
      ['a negative', -5],
      ['null', null],
      ['an empty string', ''],
      ['an object', { mb: 12 }],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY]
    ])('falls back to the default for %s', (_label, value) => {
      const service = serviceWith({ [key('avatar', 'maxFileSizeMb')]: value });
      expect(service.effectivePolicy('avatar')!.maxBytes)
        .toBe(service.defaultPolicyFor('avatar')!.maxBytes);
    });

    it('costs only its own field, not the whole policy', () => {
      const service = serviceWith({
        [key('avatar', 'maxFileSizeMb')]: 'nonsense',
        [key('avatar', 'maxWidthPx')]: 2048
      });
      const policy: any = service.effectivePolicy('avatar');
      expect(policy.maxBytes).toBe(service.defaultPolicyFor('avatar')!.maxBytes);
      expect(policy.maxWidth).toBe(2048);
    });

    it('accepts a numeric string, because a form gives one back', () => {
      const service = serviceWith({ [key('avatar', 'maxFileSizeMb')]: '8' });
      expect(service.effectivePolicy('avatar')!.maxBytes).toBe(8 * 1024 * 1024);
    });

    it('leaves every axis a finite positive number whatever is stored', () => {
      const service = serviceWith(
        Object.fromEntries(UPLOAD_POLICY_TYPES.flatMap((type) => [
          [key(type, 'maxFileSizeMb'), -1],
          [key(type, 'maxWidthPx'), 'x']
        ]))
      );
      for (const type of UPLOAD_POLICY_TYPES) {
        const policy: any = service.effectivePolicy(type);
        const axes = policy.mediaKind === 'image'
          ? ['maxBytes', 'maxWidth', 'maxHeight', 'maxPixels', 'maxFrames', 'maxDurationMs']
          : ['maxBytes', 'maxWidth', 'maxHeight', 'maxDurationMs', 'maxFrameRate'];
        for (const axis of axes) {
          expect({ type, axis, ok: Number.isFinite(policy[axis]) && policy[axis] > 0 })
            .toEqual({ type, axis, ok: true });
        }
      }
    });
  });

  describe('what may be written', () => {
    it('accepts a sensible value', () => {
      expect(validateUploadLimitSetting(key('post-photo', 'maxFileSizeMb'), 25)).toBeNull();
    });

    it('refuses a non-number', () => {
      expect(validateUploadLimitSetting(key('post-photo', 'maxFileSizeMb'), 'big'))
        .toMatch(/must be a number/i);
    });

    it('refuses zero and negatives', () => {
      expect(validateUploadLimitSetting(key('post-photo', 'maxWidthPx'), 0))
        .toMatch(/greater than zero/i);
      expect(validateUploadLimitSetting(key('post-photo', 'maxWidthPx'), -10))
        .toMatch(/greater than zero/i);
    });

    it('refuses an empty value rather than treating it as "no limit"', () => {
      expect(validateUploadLimitSetting(key('post-photo', 'maxFrames'), '')).toMatch(/required/i);
      expect(validateUploadLimitSetting(key('post-photo', 'maxFrames'), null)).toMatch(/required/i);
    });

    it('explains a pixel budget that contradicts the width limit', () => {
      const problem = validateUploadLimitSetting(key('avatar', 'maxPixelsMp'), 0.002);
      expect(problem).toMatch(/max width/i);
      // Actionable: it names the number that has to move.
      expect(problem).toContain('4096');
    });

    it('sees the contradiction from the other side too', () => {
      const problem = validateUploadLimitSetting(key('avatar', 'maxWidthPx'), 20000, {
        [key('avatar', 'maxPixelsMp')]: 0.001
      });
      expect(problem).toMatch(/max pixels is too low/i);
    });

    it('refuses a field that does not belong to the type', () => {
      // Frame rate is a video axis. Offering it for an avatar would be offering
      // a setting nothing reads.
      expect(validateUploadLimitSetting(key('avatar', 'maxFrameRate'), 30))
        .toMatch(/not an adjustable limit/i);
    });

    it('refuses an upload type that is not registered', () => {
      expect(validateUploadLimitSetting(key('post-phto', 'maxFileSizeMb'), 5))
        .toMatch(/not an upload type/i);
    });

    it('ignores every key this feature does not own', () => {
      // The validator sits on the one setting-write path, so it has to be silent
      // about site names, logos and everything else.
      expect(validateUploadLimitSetting('site.identity.name', 'Douyin Clone')).toBeNull();
      expect(validateUploadLimitSetting('site.maintenance.enabled', false)).toBeNull();
    });
  });

  describe('what is handed to the file server', () => {
    it('carries every adjustable axis and nothing else', () => {
      const service = serviceWith({ [key('avatar', 'maxFileSizeMb')]: 7 });
      const limits = service.limitsForRecord(service.effectivePolicy('avatar')!);

      expect(Object.keys(limits).sort()).toEqual([
        'maxBytes', 'maxDurationMs', 'maxFrames', 'maxHeight', 'maxPixels', 'maxWidth'
      ]);
      expect(limits.maxBytes).toBe(7 * 1024 * 1024);
      // Not adjustable, so not sent — the file server has its own copy.
      expect(limits).not.toHaveProperty('maxVideoBitrate');
    });

    it('carries the video axes for a video type', () => {
      const service = serviceWith();
      const limits = service.limitsForRecord(service.effectivePolicy('post-video')!);
      expect(Object.keys(limits).sort()).toEqual([
        'maxBytes', 'maxDurationMs', 'maxFrameRate', 'maxHeight', 'maxWidth'
      ]);
    });

    it('sends the defaults when nothing is overridden, so the record is explicit', () => {
      // The record states the whole policy rather than "the defaults, whatever
      // those are". That is what pins an in-flight upload to the numbers that
      // were in force when its token was issued.
      const service = serviceWith();
      const limits = service.limitsForRecord(service.effectivePolicy('cover')!);
      expect(limits.maxBytes).toBe(10 * 1024 * 1024);
      expect(limits.maxWidth).toBe(8192);
    });
  });
});
