/**
 * Canonical visible English labels for the personal-content collections.
 *
 * These names are shown in two places that are far apart in the tree — the
 * profile tab strip (`creator-profile-page.tsx`) and the header account menu
 * (`user-account-dropdown.tsx`) — and they must agree, because they are two
 * routes to the same collection.
 *
 * ## Why this file exists at all
 *
 * The account menu spelled the watch-later label `'We&apos;ll look at it later'`
 * inside a **JavaScript string**, not JSX text. An HTML entity is decoded by the
 * markup parser; a string literal is handed to React verbatim and rendered as
 * text, so the menu displayed the characters `&apos;` to the viewer while the
 * profile tab a click away spelled the same label correctly with `\'`. Two
 * copies of one label is what let them disagree.
 *
 * Rules for anything added here:
 *
 * - **Write the real character.** `'` (U+0027) or a typographic apostrophe —
 *   never an HTML entity. Nothing in this app parses these as markup.
 * - **Never interpolate one of these into `dangerouslySetInnerHTML`.** They are
 *   text, and text is what React escapes for you.
 * - A new surface showing one of these collections imports the label from here
 *   rather than retyping it.
 */

export const PROFILE_COLLECTION_LABELS = {
  /** Posts the viewer has liked. */
  liked: 'I like it',
  /** Posts the viewer has saved. */
  collection: 'My collection',
  /** Recently watched posts. */
  watchHistory: 'Watch history',
  /**
   * Posts kept for later.
   *
   * The apostrophe here is a real `'`. If this ever renders as `We&apos;ll` on
   * screen, something is treating the string as markup.
   */
  watchLater: 'We\'ll look at it later',
  /** The viewer's own posts. */
  work: 'My work',
  /** Scheduled/booked items. */
  appointment: 'My appointment'
} as const;

export type ProfileCollectionLabelKey = keyof typeof PROFILE_COLLECTION_LABELS;
