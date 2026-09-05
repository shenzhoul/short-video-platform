/**
 * The avatar a user should be shown with.
 *
 * ## Why this exists
 *
 * "No avatar" was rendered three different ways across this app: most call
 * sites wrote `user.avatar || '/no_avatar.jpeg'` inline (23 files), while the
 * account dropdown rendered an `AvatarIcon` glyph on a grey disc instead — so
 * the same account looked different in the header from everywhere else. This
 * is a presentation fallback and belongs in one place.
 *
 * ## What it deliberately does NOT do
 *
 * It never writes anything. `no_avatar.jpeg` is a static asset in `public/`,
 * not an upload: there is no file-server record, no R2 object and no Mongo
 * field holding this path. A user without an avatar has `avatar` absent in the
 * database and stays that way — which is what keeps "has never set an avatar"
 * distinguishable from "chose this picture", and what stops the unused-file
 * sweeper and the profile-image reference logic from ever seeing a phantom.
 *
 * ## Whitespace
 *
 * An empty string is falsy and would already fall through, but `'   '` is not.
 * A value that is only whitespace is not a URL, so it is treated as absent
 * rather than emitted into `src` — where it resolves against the page URL and
 * silently re-requests the current document.
 */

/** The static placeholder, served from `user/public/`. */
export const DEFAULT_AVATAR_URL = '/no_avatar.jpeg';

/**
 * Resolve an avatar URL for display, falling back to the shared placeholder.
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
