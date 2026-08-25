/**
 * What a video file *is*, decided from its bytes.
 *
 * The sibling of `image-content.ts`, and it exists for the same reason: the
 * extension, the browser's `File.type` and the TUS `filetype` metadata are all
 * chosen by whoever uploads, and renaming `song.mp3` to `clip.mp4` changes every
 * one of them at once. The leading bytes are written by the muxer and cannot be
 * edited without producing a different file.
 *
 * The sniff is a whitelist. An unrecognised container is refused, which fails
 * closed when a new one appears rather than letting through exactly the format
 * nobody thought about.
 */

/** The containers this service will open. Matches the shared policy's list. */
export type VideoContainer = 'mp4' | 'mov' | 'webm';

/** Longest header this needs. An ISO-BMFF brand list can run past 24 bytes. */
export const VIDEO_SNIFF_BYTES = 64;

const startsWith = (buffer: Buffer, bytes: number[], offset = 0): boolean => {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
};

/**
 * ISO-BMFF brands that mean "MP4" rather than "MOV" or "a picture".
 *
 * The same `ftyp` box carries MP4, MOV, AVIF and HEIC, so the brand is the only
 * thing separating a video from a still image at this level — which is exactly
 * why `image-content.ts` reads the same field and reaches the opposite
 * conclusion. The two lists must not overlap, and they do not.
 */
const MP4_BRANDS = new Set([
  'isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'mp4v',
  'avc1', 'dash', 'mmp4', 'm4v ', 'm4a ', 'f4v ', 'cmfc'
]);

/** MOV's own brands. QuickTime uses `qt  `; camera files often add a variant. */
const MOV_BRANDS = new Set(['qt  ', 'qt']);

/**
 * The container these bytes really are, or `null` for anything else.
 *
 * Only the header is read, which is enough to identify a container and all that
 * can be done cheaply. Whether the rest of the file is intact is a question for
 * the probe and the decode — see `VideoContentValidationService`.
 */
export function detectVideoContainer(buffer: Buffer): VideoContainer | null {
  if (!buffer || buffer.length < 12) return null;

  // Matroska/WebM: the EBML header magic. WebM is a Matroska profile, and the
  // DocType inside says which — that distinction is left to the probe, because
  // reading it here would mean parsing EBML varints for no extra safety.
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm';

  // ISO base media file format: a `ftyp` box at offset 4.
  if (startsWith(buffer, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = buffer.subarray(8, 12).toString('latin1').toLowerCase();
    if (MOV_BRANDS.has(brand)) return 'mov';
    if (MP4_BRANDS.has(brand)) return 'mp4';

    // Some muxers write an unfamiliar major brand and list a familiar one in
    // the compatible-brands array that follows. Scanning it is what keeps a
    // legitimate phone recording from being refused for a brand nobody has
    // heard of, and it cannot widen the whitelist — every brand it can match is
    // already in one of the two sets above.
    const compatible = buffer.subarray(16, Math.min(buffer.length, 64)).toString('latin1').toLowerCase();
    for (let offset = 0; offset + 4 <= compatible.length; offset += 4) {
      const candidate = compatible.slice(offset, offset + 4);
      if (MOV_BRANDS.has(candidate)) return 'mov';
      if (MP4_BRANDS.has(candidate)) return 'mp4';
    }
    return null;
  }

  return null;
}

/**
 * Normalise what `ffprobe` calls a container into the whitelist's vocabulary.
 *
 * `format_name` is a comma-separated list of every demuxer that claimed the
 * file — `mov,mp4,m4a,3gp,3g2,mj2` for the whole ISO-BMFF family, `matroska,webm`
 * for the other. So the probe cannot, on its own, tell an MP4 from a MOV; the
 * header sniff is what does that, and this only has to agree with it at the
 * family level.
 */
export function normaliseProbedContainer(formatName?: string | null): VideoContainer | null {
  if (!formatName) return null;
  const names = formatName.toLowerCase().split(',').map((name) => name.trim());
  if (names.includes('webm') || names.includes('matroska')) return 'webm';
  if (names.includes('mov') || names.includes('mp4') || names.includes('m4v')) return 'mp4';
  return null;
}

/** Whether a sniffed container and a probed one describe the same family. */
export function containersAgree(sniffed: VideoContainer, probed: VideoContainer): boolean {
  // MP4 and MOV share a demuxer, so the probe reports the family and the sniff
  // reports the member. Treating that as a disagreement would refuse every MOV.
  if (probed === 'mp4') return sniffed === 'mp4' || sniffed === 'mov';
  return sniffed === probed;
}

/** The MIME type stored on the record for a container we accepted. */
export function mimeTypeForContainer(container: VideoContainer): string {
  if (container === 'mov') return 'video/quicktime';
  if (container === 'webm') return 'video/webm';
  return 'video/mp4';
}

/**
 * A frame rate from `ffprobe`'s rational strings, or `null`.
 *
 * `avg_frame_rate` arrives as `"30000/1001"` and is `"0/0"` for a stream with
 * no meaningful rate. Both are handled: a zero denominator is not a slow video,
 * it is an absent answer, and returning `0` for it would silently pass a frame
 * rate limit that was never actually measured.
 */
export function parseFrameRate(rate?: string | null): number | null {
  if (typeof rate !== 'string') return null;
  const [numerator, denominator] = rate.split('/');
  const top = Number(numerator);
  const bottom = denominator === undefined ? 1 : Number(denominator);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom === 0) return null;
  const value = top / bottom;
  return Number.isFinite(value) && value > 0 ? value : null;
}
