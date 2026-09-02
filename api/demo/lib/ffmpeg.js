/**
 * ffprobe and ffmpeg wrappers.
 *
 * Both are spawned as child processes with an explicit timeout and a bounded
 * output buffer. A demo script is not a hostile-input path, but the same two
 * rules apply for the same reason they do in `file-server`: a probe that hangs
 * blocks the whole fetch, and a probe whose stderr is retained without a cap can
 * grow without limit on a malformed file.
 *
 * Error text from either binary is logged, never surfaced as advice — "moov
 * atom not found" is a fact about a demuxer, not something the caller can act
 * on. Callers get a short reason this module wrote.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

/** Keep at most this much of a child's stderr. */
const MAX_OUTPUT_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 120000;

function run(binary, args, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    execFile(
      binary,
      args,
      { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, killSignal: 'SIGKILL', windowsHide: true },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: stdout || '',
          stderr: stderr || '',
          // `killed` is how a timeout presents; the caller reports it as a
          // timeout rather than as a decode failure.
          timedOut: Boolean(error && error.killed)
        });
      }
    );
  });
}

/** Whether both binaries are on PATH. Checked once, before any work starts. */
async function assertFfmpegAvailable() {
  const [probe, encoder] = await Promise.all([
    run('ffprobe', ['-version'], { timeoutMs: 15000 }),
    run('ffmpeg', ['-version'], { timeoutMs: 15000 })
  ]);
  if (!probe.ok || !encoder.ok) {
    throw new Error(
      'ffmpeg and ffprobe must be on PATH. They are used to validate downloaded '
      + 'video and to extract poster frames. Install FFmpeg and re-run.'
    );
  }
}

/**
 * Read a video's streams and format.
 *
 * @returns `{ ok: true, info }` or `{ ok: false, reason }` — never the probe's
 *   own error text.
 */
async function probeVideo(filePath) {
  const result = await run('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath
  ]);

  if (result.timedOut) return { ok: false, reason: 'probe timed out', detail: result.stderr };
  if (!result.ok) return { ok: false, reason: 'file could not be read as video', detail: result.stderr };

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { ok: false, reason: 'probe produced unreadable output' };
  }

  const streams = parsed.streams || [];
  // `attached_pic` is cover art carried inside an audio file. Counting it as a
  // video stream is how an MP3 renamed .mp4 passes for a video.
  const videoStreams = streams.filter(
    (s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1
  );
  if (videoStreams.length === 0) {
    return { ok: false, reason: 'contains no real video stream' };
  }

  const video = videoStreams[0];
  const audio = streams.find((s) => s.codec_type === 'audio') || null;
  const durationSeconds = Number(parsed.format?.duration ?? video.duration ?? 0);

  return {
    ok: true,
    info: {
      container: (parsed.format?.format_name || '').split(',').map((v) => v.trim()),
      durationMs: Number.isFinite(durationSeconds) ? Math.round(durationSeconds * 1000) : 0,
      bitrate: Number(parsed.format?.bit_rate ?? 0) || null,
      width: Number(video.width ?? 0),
      height: Number(video.height ?? 0),
      videoCodec: video.codec_name || null,
      audioCodec: audio?.codec_name || null,
      frameRate: parseFrameRate(video.avg_frame_rate || video.r_frame_rate),
      videoStreamCount: videoStreams.length
    }
  };
}

/** `"30000/1001"` to 29.97. Returns null for the `0/0` ffprobe emits for stills. */
function parseFrameRate(value) {
  if (!value || typeof value !== 'string') return null;
  const [num, den] = value.split('/').map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0 || num === 0) return null;
  return Math.round((num / den) * 100) / 100;
}

/**
 * Decode a single frame near the end of the file.
 *
 * A truncated MP4 with a faststart header reports a full duration and a healthy
 * stream from its header alone, and only fails when something actually decodes
 * the missing tail — which, in this project, is the transcode worker, minutes
 * later, on a queue. Seeking near the end costs an index seek rather than a full
 * decode and catches exactly that case.
 *
 * This is not a full integrity proof. It does not decode the middle of the file,
 * so a corrupt region between the seek point and the end goes unnoticed.
 */
async function decodesNearEnd(filePath, durationMs) {
  const seekSeconds = Math.max(0, (durationMs - 2000) / 1000);
  const result = await run('ffmpeg', [
    '-v', 'error',
    '-xerror',
    '-ss', seekSeconds.toFixed(3),
    '-i', filePath,
    '-frames:v', '1',
    '-f', 'null',
    '-'
  ], { timeoutMs: 60000 });

  if (result.timedOut) return { ok: false, reason: 'end-frame decode timed out' };
  if (!result.ok) return { ok: false, reason: 'file is truncated or corrupt', detail: result.stderr };
  return { ok: true };
}

/**
 * Extract a poster frame from the video itself.
 *
 * From the video rather than from a stock still, so a post's thumbnail is
 * genuinely a frame of the clip it belongs to. Taken about a third of the way
 * in: the first frames of a clip are often a fade or a slate.
 */
async function extractPosterFrame(videoPath, outputPath, durationMs) {
  const seekSeconds = Math.max(0.5, Math.min(durationMs / 1000 * 0.33, durationMs / 1000 - 0.5));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const result = await run('ffmpeg', [
    '-v', 'error',
    '-y',
    '-ss', seekSeconds.toFixed(3),
    '-i', videoPath,
    '-frames:v', '1',
    // Even dimensions and a sane ceiling; the pipeline re-encodes anyway, and a
    // 4K still as a thumbnail is wasted bytes on every feed card.
    '-vf', 'scale=\'min(1080,iw)\':-2',
    '-q:v', '3',
    outputPath
  ], { timeoutMs: 60000 });

  if (result.timedOut) return { ok: false, reason: 'thumbnail extraction timed out' };
  if (!result.ok) return { ok: false, reason: 'could not extract a frame', detail: result.stderr };
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    return { ok: false, reason: 'thumbnail extraction produced an empty file' };
  }
  return { ok: true };
}

module.exports = {
  assertFfmpegAvailable,
  probeVideo,
  decodesNearEnd,
  extractPosterFrame
};
