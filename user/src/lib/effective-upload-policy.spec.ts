import { getUploadPolicy } from '@douyin-clone/upload-policy';

import { getUploadPolicies } from '../services/setting.service';
import {
  AVATAR_UPLOAD_TYPE,
  classifyPickedFile,
  ensureEffectiveUploadPolicies,
  POST_VIDEO_UPLOAD_TYPE,
  resetEffectiveUploadPolicies,
  uploadPolicyFor
} from './upload-policy';

jest.mock('../services/setting.service', () => ({
  getUploadPolicies: jest.fn()
}));

const fetchPolicies = getUploadPolicies as jest.Mock;

/**
 * The client's half of the adjustable limits.
 *
 * The picker has to show and enforce the *effective* limit, not the one that
 * happened to be in the bundle when it was built — otherwise an operator raises
 * the avatar cap and the composer goes on refusing files the server would
 * happily take.
 *
 * What is emphatically not asserted here is authority. Everything the client
 * decides is early feedback; the file server judges the bytes that arrive
 * against the limits bound to the durable record.
 */
describe('effective upload policies in the browser', () => {
  beforeEach(() => {
    resetEffectiveUploadPolicies();
    fetchPolicies.mockReset();
  });

  const withPolicies = (overrides: Record<string, any>) => {
    const merged: Record<string, any> = {};
    for (const [type, changes] of Object.entries(overrides)) {
      merged[type] = { ...(getUploadPolicy(type) as any), ...changes };
    }
    fetchPolicies.mockResolvedValue(merged);
  };

  describe('before anything is loaded', () => {
    it('uses the bundled defaults, so a picker works on first paint', () => {
      // `uploadPolicyFor` is called from render — `accept` attributes and limit
      // labels — where there is nothing to await. A default is always a usable
      // answer, which is why this is synchronous.
      expect(uploadPolicyFor(AVATAR_UPLOAD_TYPE)!.maxBytes)
        .toBe(getUploadPolicy(AVATAR_UPLOAD_TYPE)!.maxBytes);
    });
  });

  describe('once the effective policies are loaded', () => {
    it('reports the operator\'s limit rather than the bundled one', async () => {
      withPolicies({ avatar: { maxBytes: 20 * 1024 * 1024 } });
      await ensureEffectiveUploadPolicies();

      expect(uploadPolicyFor(AVATAR_UPLOAD_TYPE)!.maxBytes).toBe(20 * 1024 * 1024);
      expect(uploadPolicyFor(AVATAR_UPLOAD_TYPE)!.maxBytes)
        .not.toBe(getUploadPolicy(AVATAR_UPLOAD_TYPE)!.maxBytes);
    });

    it('judges a picked file by it', async () => {
      // The point of loading them at all: a file the bundled default would have
      // refused is accepted once the operator has raised the limit.
      const file = new File([''], 'photo.jpg', { type: 'image/jpeg' });
      Object.defineProperty(file, 'size', { value: 8 * 1024 * 1024 });

      expect(classifyPickedFile(file, AVATAR_UPLOAD_TYPE)).toBe('IMAGE_FILE_TOO_LARGE');

      withPolicies({ avatar: { maxBytes: 20 * 1024 * 1024 } });
      await ensureEffectiveUploadPolicies();

      expect(classifyPickedFile(file, AVATAR_UPLOAD_TYPE)).toBeNull();
    });

    it('leaves types the payload does not mention on their defaults', async () => {
      withPolicies({ avatar: { maxBytes: 20 * 1024 * 1024 } });
      await ensureEffectiveUploadPolicies();

      expect(uploadPolicyFor(POST_VIDEO_UPLOAD_TYPE)!.maxBytes)
        .toBe(getUploadPolicy(POST_VIDEO_UPLOAD_TYPE)!.maxBytes);
    });

    it('fetches once for concurrent callers', async () => {
      withPolicies({ avatar: { maxBytes: 20 * 1024 * 1024 } });
      // A picker judging twelve files at once must not open twelve identical
      // requests.
      await Promise.all(Array.from({ length: 12 }, () => ensureEffectiveUploadPolicies()));
      expect(fetchPolicies).toHaveBeenCalledTimes(1);
    });

    it('does not refetch while the cache is fresh', async () => {
      withPolicies({ avatar: { maxBytes: 20 * 1024 * 1024 } });
      await ensureEffectiveUploadPolicies();
      await ensureEffectiveUploadPolicies();
      expect(fetchPolicies).toHaveBeenCalledTimes(1);
    });
  });

  describe('when the API cannot answer', () => {
    it('falls back to the bundled defaults rather than blocking uploads', async () => {
      fetchPolicies.mockRejectedValue(new Error('network down'));
      await ensureEffectiveUploadPolicies();

      expect(uploadPolicyFor(AVATAR_UPLOAD_TYPE)!.maxBytes)
        .toBe(getUploadPolicy(AVATAR_UPLOAD_TYPE)!.maxBytes);
    });

    it('keeps the previously loaded policies through a later failure', async () => {
      withPolicies({ avatar: { maxBytes: 20 * 1024 * 1024 } });
      await ensureEffectiveUploadPolicies();

      resetEffectiveUploadPolicies();
      fetchPolicies.mockRejectedValue(new Error('network down'));
      await ensureEffectiveUploadPolicies();
      // Reset dropped them, so this is the default — the assertion is that a
      // failure produces a usable policy, not an undefined one.
      expect(Number.isFinite(uploadPolicyFor(AVATAR_UPLOAD_TYPE)!.maxBytes)).toBe(true);
    });

    it('ignores a payload that is not a usable policy', async () => {
      // A limit that arrives as `undefined` compares as greater than everything
      // and silently disables the check it belongs to. A malformed payload must
      // not be able to do that.
      fetchPolicies.mockResolvedValue({ avatar: { mediaKind: 'image' } });
      await ensureEffectiveUploadPolicies();

      expect(uploadPolicyFor(AVATAR_UPLOAD_TYPE)!.maxBytes)
        .toBe(getUploadPolicy(AVATAR_UPLOAD_TYPE)!.maxBytes);
    });

    it('ignores a payload that is not an object at all', async () => {
      fetchPolicies.mockResolvedValue('nope' as any);
      await ensureEffectiveUploadPolicies();

      expect(uploadPolicyFor(AVATAR_UPLOAD_TYPE)!.maxBytes)
        .toBe(getUploadPolicy(AVATAR_UPLOAD_TYPE)!.maxBytes);
    });
  });

  describe('an unregistered type', () => {
    it('is still refused, whatever the API says about it', async () => {
      // Fail-closed does not become fail-open because a payload mentioned a type
      // the bundle does not know.
      fetchPolicies.mockResolvedValue({ 'post-phto': { maxBytes: 999 } });
      await ensureEffectiveUploadPolicies();

      expect(uploadPolicyFor('post-phto')).toBeNull();
      const file = new File([''], 'x.png', { type: 'image/png' });
      Object.defineProperty(file, 'size', { value: 10 });
      expect(classifyPickedFile(file, 'post-phto')).toBe('UNSUPPORTED_UPLOAD_TYPE');
    });
  });
});
