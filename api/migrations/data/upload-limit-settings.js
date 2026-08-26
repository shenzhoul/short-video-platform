/**
 * Seed definitions for the adjustable upload limits.
 *
 * ## Generated, not typed out
 *
 * Fifty-seven settings — ten upload types times their adjustable fields — and
 * every default has to match `shared/upload-policy` exactly. Writing them by
 * hand would guarantee that one of them eventually did not, and the failure
 * would be invisible: the admin form would show a number the validators never
 * used. So the registry generates them, and there is only one place the defaults
 * exist.
 *
 * ## A blank database needs nothing from an operator
 *
 * `value` is the registry default, so a fresh install behaves exactly as it did
 * before this feature existed. And because the API falls back to the code
 * default whenever a setting is missing or unreadable, an installation that
 * never runs this migration still works — the migration makes the numbers
 * *visible and editable*, not functional.
 */
const {
  UPLOAD_LIMIT_SETTING_GROUP,
  UPLOAD_HARD_CEILINGS,
  UPLOAD_POLICY_TYPES,
  getUploadPolicy,
  uploadLimitFieldsFor,
  uploadLimitSettingKey
} = require('@douyin-clone/upload-policy');

/** `post-photo` -> `Post photo`, for a label a person reads rather than parses. */
const humanType = (type) => {
  const words = type.split('-');
  return words
    .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
};

/**
 * What each upload type is actually for, in the words an operator would use.
 *
 * The admin screen shows this once per section instead of repeating it on every
 * field, which is what made the flat list unreadable. A type missing from here
 * still renders — it falls back to the generic sentence below — so registering a
 * new upload type never breaks the screen, it only makes it vaguer until someone
 * writes the line.
 */
const TYPE_PURPOSE = Object.freeze({
  'comment-photo': 'Photos people attach to a comment.',
  'message-photo': 'Photos sent inside a direct message.',
  'post-photo': 'The photos that make up a graphic post.',
  'post-thumbnail': 'Cover images a creator uploads for a post.',
  avatar: 'Profile pictures.',
  cover: 'Profile cover banners.',
  'setting-file': 'Images an admin uploads in Settings, such as the logo and favicon.',
  'post-video': 'The main video of a video post.',
  'post-teaser': 'Short teaser clips attached to a post.',
  'message-video': 'Videos sent inside a direct message.'
});

/** The heading a section groups under in the admin navigation. */
const SECTION_GROUPS = Object.freeze({ image: 'Images', video: 'Videos' });

/** Trim floating-point noise from a unit conversion (`5.000000001` -> `5`). */
const inDisplayUnits = (value, factor) => {
  const converted = value / factor;
  return Number.isInteger(converted) ? converted : Number(converted.toFixed(3));
};

const settings = [];
let ordering = 0;

for (const type of UPLOAD_POLICY_TYPES) {
  const policy = getUploadPolicy(type);
  const ceilings = UPLOAD_HARD_CEILINGS[policy.mediaKind] || {};

  const kindWord = policy.mediaKind === 'video' ? 'Video' : 'Image';
  const sectionLabel = humanType(type);
  // Said once per section rather than on all six of its fields. Everything here
  // was previously repeated verbatim in every single description, which is what
  // made the screen a wall of identical sentences.
  const sectionNote = `${TYPE_PURPOSE[type] || `${kindWord} uploads of type "${type}".`} `
    + `Applies to new uploads only; files already stored are never re-checked.`;

  for (const spec of uploadLimitFieldsFor(type)) {
    ordering += 1;
    const key = uploadLimitSettingKey(type, spec.settingSuffix);
    const ceiling = ceilings[spec.field];

    settings.push({
      // Nothing to rename from: these keys are new, so the old-key lookup the
      // seeder does simply finds nothing and inserts the default.
      oldKey: key,
      newData: {
        key,
        value: inDisplayUnits(policy[spec.field], spec.factor),
        // Just the field. The section heading carries the upload type, so the
        // old `Comment photo · Max width (px)` prefix is redundant there.
        name: spec.label,
        description: ceiling
          ? `Cannot be set above ${inDisplayUnits(ceiling, spec.factor)}${spec.unit}.`
          : '',
        type: 'number',
        // Public because the uploader in the web app has to show the same limit
        // it will be held to. These are limits, not secrets — the file server
        // announces every one of them in a rejection anyway.
        public: true,
        // Not autoloaded: fifty-seven numbers do not belong in the payload every
        // page load already carries. The web app asks for them once, by group.
        autoload: false,
        group: UPLOAD_LIMIT_SETTING_GROUP,
        editable: true,
        visible: true,
        meta: {
          // The admin form reads these for the input's own bounds. They are a
          // convenience, not the enforcement — the API validates every write and
          // the file server clamps again.
          min: spec.step < 1 ? spec.step : 1,
          max: ceiling ? inDisplayUnits(ceiling, spec.factor) : undefined,
          step: spec.step,
          uploadType: type,
          limitField: spec.field,
          // Presentation metadata the admin settings screen groups on. Generic
          // on purpose: any future settings group can split itself into sections
          // the same way without the admin app learning about upload limits.
          section: type,
          sectionLabel,
          sectionGroup: SECTION_GROUPS[policy.mediaKind] || 'Other',
          sectionNote
        },
        ordering
      }
    });
  }
}

module.exports = settings;
