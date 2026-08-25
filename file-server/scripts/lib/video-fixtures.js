/**
 * Real video fixtures, built by the real FFmpeg.
 *
 * ## Why these are generated and not committed
 *
 * A 4K frame, a 61-second clip and a 120fps clip are megabytes each, and a
 * repository is a bad place to keep binaries whose only purpose is to be decoded
 * once. More importantly, a *committed* fixture is a fixture nobody can check:
 * the whole point of the video policy is that the file server's answer agrees
 * with what FFmpeg actually reports, and the only way to know a fixture really
 * is 61 seconds of VP9 is to have FFmpeg make it and `ffprobe` confirm it.
 *
 * So every fixture is produced into a temp directory at run time, probed to
 * confirm it is what was asked for, and deleted afterwards. A fixture that does
 * not probe as expected fails the run rather than being quietly used — a test
 * that passes because its fixture was wrong is worse than no test.
 *
 * ## Everything is synthetic
 *
 * `lavfi` sources — flat colour, a sine tone, a test pattern — so nothing here
 * depends on a sample file existing, on a network, or on anyone's media library.
 */

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

/** Long enough for a slow 4K or 61-second encode, short enough to notice a hang. */
const ENCODE_TIMEOUT_MS = 180000;

/** Whether FFmpeg and ffprobe are both callable. The harness skips without them. */
function hasFfmpeg() {
  for (const binary of [FFMPEG, FFPROBE]) {
    const probe = spawnSync(binary, ['-version'], { stdio: 'ignore', timeout: 15000 });
    if (probe.error || probe.status !== 0) return false;
  }
  return true;
}

function run(args) {
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: ['ignore', 'ignore', 'pipe'],
    timeout: ENCODE_TIMEOUT_MS
  });
}

/** What `ffprobe` says about a file, as the harness's own independent check. */
function probe(filePath) {
  const output = execFileSync(FFPROBE, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath
  ], { encoding: 'utf8', timeout: 30000 });

  const parsed = JSON.parse(output);
  const video = (parsed.streams || []).find(
    (stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1
  );
  const audio = (parsed.streams || []).find((stream) => stream.codec_type === 'audio');

  return {
    formatName: parsed.format?.format_name || '',
    durationSeconds: Number(parsed.format?.duration ?? video?.duration ?? NaN),
    videoCodec: video?.codec_name || null,
    audioCodec: audio?.codec_name || null,
    width: Number(video?.width ?? NaN),
    height: Number(video?.height ?? NaN),
    videoStreams: (parsed.streams || []).filter(
      (stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1
    ).length
  };
}

/**
 * An H.264/MP4 clip of a stated size, length and frame rate.
 *
 * `+faststart` puts the `moov` atom at the front, which is what production
 * encoders do and what makes the truncation fixture below meaningful: a
 * truncated faststart MP4 still reports a full duration from its header, so
 * `ffprobe` alone cannot tell it is broken.
 */
function writeMp4(filePath, { width = 64, height = 64, seconds = 2, fps = 30 } = {}) {
  run([
    '-f', 'lavfi',
    '-i', `color=c=blue:s=${width}x${height}:r=${fps}:d=${seconds}`,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    filePath
  ]);
  return filePath;
}

/** The same clip with an AAC track, so the audio-codec path is exercised. */
function writeMp4WithAudio(filePath, { width = 64, height = 64, seconds = 2 } = {}) {
  run([
    '-f', 'lavfi', '-i', `color=c=red:s=${width}x${height}:r=30:d=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-shortest',
    '-movflags', '+faststart',
    filePath
  ]);
  return filePath;
}

/** A VP9/WebM clip — the other container the policy accepts. */
function writeWebm(filePath, { width = 64, height = 64, seconds = 1 } = {}) {
  run([
    '-f', 'lavfi', '-i', `color=c=green:s=${width}x${height}:r=15:d=${seconds}`,
    '-c:v', 'libvpx-vp9',
    '-b:v', '50k',
    '-deadline', 'realtime',
    '-cpu-used', '8',
    filePath
  ]);
  return filePath;
}

/** An H.264/MOV clip, so the MOV branch of the header sniff is covered. */
function writeMov(filePath, { width = 64, height = 64, seconds = 1 } = {}) {
  run([
    '-f', 'lavfi', '-i', `color=c=yellow:s=${width}x${height}:r=15:d=${seconds}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-f', 'mov',
    filePath
  ]);
  return filePath;
}

/**
 * An audio-only MP4, whatever it gets named.
 *
 * The classic disguise: a valid MP4 container with nothing to play. Every
 * extension check, MIME check and header sniff passes it, because it really is
 * an MP4 — only counting the video streams catches it.
 */
function writeAudioOnlyMp4(filePath, { seconds = 2 } = {}) {
  run([
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-c:a', 'aac',
    '-movflags', '+faststart',
    filePath
  ]);
  return filePath;
}

/**
 * An MP4 carrying a codec the pipeline will not transcode.
 *
 * MPEG-2 is a good choice for this: FFmpeg reads it perfectly, so it fails only
 * the whitelist and not the probe — which is exactly the case that would slip
 * through if the check were "did ffprobe manage to open it".
 */
function writeUnsupportedCodecMp4(filePath, { seconds = 1 } = {}) {
  run([
    '-f', 'lavfi', '-i', `color=c=white:s=64x64:r=15:d=${seconds}`,
    '-c:v', 'mpeg2video',
    '-b:v', '200k',
    filePath
  ]);
  return filePath;
}

/** Two real video streams in one container: more than the policy allows. */
function writeTwoVideoStreamsMp4(filePath, { seconds = 1 } = {}) {
  run([
    '-f', 'lavfi', '-i', `color=c=blue:s=64x64:r=15:d=${seconds}`,
    '-f', 'lavfi', '-i', `color=c=red:s=64x64:r=15:d=${seconds}`,
    '-map', '0:v', '-map', '1:v',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    filePath
  ]);
  return filePath;
}

/**
 * A faststart MP4 with its tail cut off.
 *
 * This is the fixture the whole tail-decode check exists for. The header is
 * intact and states the full duration, so the byte check passes, the sniff
 * passes, `ffprobe` reports a perfectly good stream — and the payload simply
 * stops. Nothing short of decoding near the end notices.
 *
 * `keepFraction` is deliberately generous: cutting too aggressively can remove
 * enough of the stream that ffprobe itself complains, which would make the
 * fixture prove a different (easier) thing than intended.
 */
function writeTruncatedMp4(filePath, { seconds = 6, keepFraction = 0.45 } = {}) {
  // The extension has to stay `.mp4`: FFmpeg picks its muxer from it, and a
  // path ending in `.source` makes it give up with "Unable to find a suitable
  // output format".
  const source = filePath.replace(/\.mp4$/, '.source.mp4');
  try {
    // A visibly changing source, so the tail really is different data rather
    // than a run of identical frames the encoder collapsed to nothing.
    run([
      '-f', 'lavfi', '-i', `testsrc=s=320x240:r=30:d=${seconds}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-g', '300',
      '-movflags', '+faststart',
      source
    ]);

    const complete = fs.readFileSync(source);
    const keep = Math.max(1024, Math.floor(complete.length * keepFraction));
    fs.writeFileSync(filePath, complete.subarray(0, keep));
  } finally {
    if (fs.existsSync(source)) fs.unlinkSync(source);
  }
  return filePath;
}

/** A still image given a video extension: not a container at all. */
function writeImageNamedAsVideo(filePath) {
  run([
    '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=0.1',
    '-frames:v', '1',
    '-f', 'image2',
    '-c:v', 'png',
    filePath
  ]);
  return filePath;
}

/** Bytes that are not any media container, for the header-sniff rejection. */
function writeNotAContainer(filePath) {
  fs.writeFileSync(filePath, Buffer.from('%PDF-1.7\n% not a video at all\n'.repeat(40)));
  return filePath;
}

module.exports = {
  FFMPEG,
  FFPROBE,
  hasFfmpeg,
  probe,
  writeMp4,
  writeMp4WithAudio,
  writeWebm,
  writeMov,
  writeAudioOnlyMp4,
  writeUnsupportedCodecMp4,
  writeTwoVideoStreamsMp4,
  writeTruncatedMp4,
  writeImageNamedAsVideo,
  writeNotAContainer,
  join: path.join
};
