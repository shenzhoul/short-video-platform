/**
 * The avatar a user should be shown with, in the admin app.
 *
 * ## Why this is a copy of `user/src/lib/avatar.ts`
 *
 * `admin` is a separate Next application in its own container, served from its
 * own origin. A root-relative `src="/no_avatar.jpeg"` resolves against *that*
 * origin, so the asset has to exist in `admin/public/` — pointing at the user
 * app's copy would make every admin page with a user list depend on the public
 * site being reachable, and would be a cross-origin request for a 2.6 KB image.
 *
 * A `shared/` package cannot help here either: Next serves `public/` from disk
 * at the app root, and `file:` dependencies are *copied* by Yarn v1 (see
 * `.agents/rules/shared.md`), so a shared package would need a build step that
 * copies the bytes into `admin/public/` anyway — the same copy, with a moving
 * part added.
 *
 * So the bytes are duplicated deliberately, and the duplication is pinned:
 * `user/src/lib/default-avatar-asset.spec.ts` compares
 * `user/public/no_avatar.jpeg` and `admin/public/no_avatar.jpeg` byte for byte
 * and fails if either is changed without the other. It runs in the user app's
 * Jest suite because `admin` has no Jest configuration yet.
 *
 * ## What it deliberately does NOT do
 *
 * It never writes anything. `no_avatar.jpeg` is a static asset, not an upload:
 * there is no file-server record, no R2 object, and no Mongo field holding this
 * path. A user who has never set an avatar keeps `avatar` absent in the
 * database, which is what stops the unused-file sweeper and the profile-image
 * reference logic from ever seeing a phantom file.
 */

/** The static placeholder, served from `admin/public/`. */
export const DEFAULT_AVATAR_URL = '/no_avatar.jpeg';

/**
 * Resolve an avatar URL for display, falling back to the shared placeholder.
 *
 * A value that is only whitespace is treated as absent rather than emitted into
 * `src`, where it would resolve against the page URL and silently re-request
 * the current document.
 *
 * @param avatar the stored avatar URL, which may be absent, null or blank
 */
export function resolveAvatarUrl(avatar?: string | null): string {
  if (typeof avatar !== 'string') return DEFAULT_AVATAR_URL;

  const trimmed = avatar.trim();
  return trimmed === '' ? DEFAULT_AVATAR_URL : trimmed;
}

/** Whether this user has a real avatar, for cases that need to branch rather than render. */
export function hasCustomAvatar(avatar?: string | null): boolean {
  return typeof avatar === 'string' && avatar.trim() !== '';
}
