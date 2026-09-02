/**
 * Procedurally drawn account avatars.
 *
 * ## Why these are not photographs
 *
 * A demo account is a fictional person. Putting a real photographed face on one
 * presents an identifiable human being as the owner of an account they have
 * never heard of, with posts they did not write — and stock licences permit the
 * image, not the impersonation. Generated faces are no better: "this is a
 * synthetic person" is invisible to anyone looking at a profile, so the claim
 * being made about the picture is the same one. So the avatars here are
 * abstract: a gradient field and a symmetric geometric mark. Nobody can mistake
 * one for a photograph of anybody.
 *
 * ## Why they are deterministic
 *
 * The seed is the account's username, so an avatar is a property of the account
 * rather than of the run that produced it. Re-running `demo:fetch-media`
 * redraws byte-identical files, which is what lets the cache and the checksum
 * dedup treat them like any downloaded media.
 *
 * ## Why they differ from each other
 *
 * Hue is spread across accounts within a theme by construction rather than left
 * to the generator — two accounts in one theme drawing neighbouring hues by
 * chance is exactly the collision a reader would notice. The mark itself is a
 * 5x5 mirrored bitfield, giving 2^15 patterns before colour is considered.
 */

const { encodePng } = require('./png');
const { createRandom } = require('./random');

/** Base hue per theme, degrees. Chosen to sit apart on the wheel. */
const THEME_HUES = {
  'street-food': 24,
  travel: 200,
  fitness: 150,
  pets: 44,
  fashion: 330,
  music: 268,
  tech: 190,
  nature: 108
};

/** HSL to RGB, all inputs 0..1 except hue in degrees. */
function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const toChannel = (t0) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(toChannel(hue + 1 / 3) * 255),
    Math.round(toChannel(hue) * 255),
    Math.round(toChannel(hue - 1 / 3) * 255)
  ];
}

const clamp01 = (v) => (v < 0 ? 0 : (v > 1 ? 1 : v));
const mix = (a, b, t) => a + (b - a) * t;
/** Smooth 0..1 ramp between two edges; used for anti-aliasing every shape. */
const smoothstep = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/**
 * Draw one avatar.
 *
 * @param username stable seed; the same username always yields the same bytes
 * @param themeKey picks the hue family
 * @param indexInTheme spreads accounts of one theme apart on the hue wheel
 * @param size square edge in pixels
 * @param accountsInTheme how many accounts share this theme's hue family
 * @returns PNG bytes
 */
function renderAvatar({
  username, themeKey, indexInTheme = 0, size = 512, accountsInTheme = 2
}) {
  const random = createRandom(`avatar:${themeKey}:${username}`);

  const baseHue = THEME_HUES[themeKey] ?? (random.int(0, 359));
  // Spread deterministically across the theme's slice, then jitter slightly so
  // two themes with adjacent bases still look unrelated.
  const spread = 46;
  const hue = baseHue + (indexInTheme - (accountsInTheme - 1) / 2) * spread + random.int(-8, 8);

  const backgroundTop = hslToRgb(hue - 14, 0.62, 0.36);
  const backgroundBottom = hslToRgb(hue + 20, 0.70, 0.17);
  const markColor = hslToRgb(hue + random.int(-10, 10), 0.85, 0.72);
  const accentColor = hslToRgb(hue + 46, 0.80, 0.62);

  // 5 columns mirrored about the centre column gives a face-like symmetry
  // without being a face. Only the left three columns are decided.
  const cells = [];
  for (let row = 0; row < 5; row += 1) {
    const left = [random.chance(0.55), random.chance(0.5), random.chance(0.62)];
    cells.push([left[0], left[1], left[2], left[1], left[0]]);
  }
  // Per-cell radius variation, so the mark reads as drawn rather than tiled.
  const radii = cells.map((row) => row.map(() => mix(0.30, 0.46, random.next())));
  const accentRow = random.int(0, 4);

  const gridSpan = size * 0.56;
  const cellSize = gridSpan / 5;
  const gridOrigin = (size - gridSpan) / 2;
  const ringRadius = size * 0.415;
  const ringWidth = size * 0.018;

  const rgb = Buffer.alloc(size * size * 3);
  const centre = size / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Diagonal gradient base.
      const t = clamp01((x * 0.45 + y * 0.85) / (size * 1.3));
      let r = mix(backgroundTop[0], backgroundBottom[0], t);
      let g = mix(backgroundTop[1], backgroundBottom[1], t);
      let b = mix(backgroundTop[2], backgroundBottom[2], t);

      // Soft off-centre highlight, so the field is not a flat ramp.
      const dxH = (x - size * 0.32) / size;
      const dyH = (y - size * 0.26) / size;
      const highlight = Math.max(0, 1 - Math.sqrt(dxH * dxH + dyH * dyH) * 2.6) ** 2 * 0.30;
      r = mix(r, 255, highlight * 0.5);
      g = mix(g, 255, highlight * 0.5);
      b = mix(b, 255, highlight * 0.5);

      const dx = x - centre;
      const dy = y - centre;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Thin ring, anti-aliased on both edges.
      const ring = smoothstep(ringRadius - ringWidth - 1.2, ringRadius - ringWidth, distance)
        * (1 - smoothstep(ringRadius, ringRadius + 1.2, distance));
      if (ring > 0) {
        r = mix(r, accentColor[0], ring * 0.55);
        g = mix(g, accentColor[1], ring * 0.55);
        b = mix(b, accentColor[2], ring * 0.55);
      }

      // The mark: one anti-aliased disc per filled cell.
      const col = Math.floor((x - gridOrigin) / cellSize);
      const row = Math.floor((y - gridOrigin) / cellSize);
      if (col >= 0 && col < 5 && row >= 0 && row < 5 && cells[row][col]) {
        const cx = gridOrigin + (col + 0.5) * cellSize;
        const cy = gridOrigin + (row + 0.5) * cellSize;
        const cd = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        // 1.35 keeps neighbouring discs just touching, so the mark reads as a
        // connected shape rather than a grid of dots, without merging into the
        // solid blocks a full 2.0 multiplier produces.
        const radius = radii[row][col] * cellSize * 1.35;
        const coverage = 1 - smoothstep(radius - 1.4, radius + 0.6, cd);
        if (coverage > 0) {
          const target = row === accentRow ? accentColor : markColor;
          r = mix(r, target[0], coverage);
          g = mix(g, target[1], coverage);
          b = mix(b, target[2], coverage);
        }
      }

      // Vignette, keeping the mark the brightest thing in the frame.
      const vignette = 1 - smoothstep(size * 0.30, size * 0.72, distance) * 0.28;
      const offset = (y * size + x) * 3;
      rgb[offset] = Math.round(clamp01(r * vignette / 255) * 255);
      rgb[offset + 1] = Math.round(clamp01(g * vignette / 255) * 255);
      rgb[offset + 2] = Math.round(clamp01(b * vignette / 255) * 255);
    }
  }

  return encodePng(rgb, size, size);
}

module.exports = { renderAvatar, THEME_HUES };
