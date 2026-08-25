import { HttpException, Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs';

import { videoConfig } from 'src/config';
import { ConcurrencyLimiter } from '../../lib/concurrency';
import {
  containersAgree,
  detectVideoContainer,
  mimeTypeForContainer,
  normaliseProbedContainer,
  parseFrameRate,
  VIDEO_SNIFF_BYTES,
  VideoContainer
} from '../../lib/video-content';
import { VideoUploadPolicy } from './upload-policy';

export interface VerifiedVideo {
  /** The container the bytes actually are, whatever the request claimed. */
  container: VideoContainer;
  /** The MIME type that belongs to that container. */
  mimeType: string;
  videoCodec: string;
  /** `null` for a silent clip, which is a normal thing to upload. */
  audioCodec: string | null;
  width: number;
  height: number;
  durationMs: number;
  frameRate: number;
  /** Bits per second for the video stream, or `null` when unreported. */
  videoBitrate: number | null;
  /** Which policy judged it, so a caller can log what was applied. */
  policy: string;
}

/**
 * How long `ffprobe` may take before it is killed.
 *
 * A probe reads a header and an index, so on any real file it finishes in tens
 * of milliseconds. Ten seconds is not a budget, it is a tripwire: a file that
 * makes the demuxer scan the whole stream looking for a `moov` that is not
 * there, or one crafted to loop it, hits this instead of holding a slot forever.
 */
const PROBE_TIMEOUT_MS = 10000;

/**
 * How long the tail decode may take before it is killed.
 *
 * Seeking is cheap and one frame is one frame, but a file with a broken index
 * can make FFmpeg scan forward from the start. Thirty seconds bounds that.
 */
const TAIL_DECODE_TIMEOUT_MS = 30000;

/**
 * Most of a child process's output that is kept.
 *
 * `ffprobe -print_format json` on a normal file is a few kilobytes; on a file
 * with thousands of streams or chapters it is not. Buffering it unbounded turns
 * a hostile upload into this process's memory problem, so the read stops here
 * and the output is treated as unusable — which is the correct answer for
 * something that produced a megabyte of JSON about itself.
 */
const MAX_PROBE_OUTPUT_BYTES = 1024 * 1024;

/** Stderr kept for the log. Never returned to a client. */
const MAX_STDERR_BYTES = 8192;

/**
 * How many probes and decodes may run at once in this process.
 *
 * Each is a child process with its own thread pool, and TUS completions arrive
 * whenever transfers happen to finish — nothing else bounds the fan-out. Two is
 * deliberately small: this runs on the same machine as the API, MongoDB and
 * Redis in the local and single-box deployments this project targets.
 */
const VIDEO_PROBE_CONCURRENCY = parseInt(process.env.VIDEO_PROBE_CONCURRENCY || '2', 10);

/**
 * How long an upload waits for a slot before it is told the server is busy.
 *
 * Bounded so a wedged probe cannot park every later upload indefinitely. The
 * refusal it produces is honest backpressure — "try again" — rather than a
 * request that never answers.
 */
const VIDEO_PROBE_QUEUE_TIMEOUT_MS = 60000;

interface ChildResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Decides whether an uploaded file really is a video the pipeline can use.
 *
 * ## Why an image validator could not do this
 *
 * Nothing about a video is answerable from a header. Sharp opens a picture and
 * reports its size; a container reports a list of streams, any of which may be
 * absent, mislabelled or lying about a duration. An audio file renamed to `.mp4`
 * is a *valid MP4* — it just has no video stream in it, which is a question only
 * a probe can ask. So this is its own service with its own vocabulary, and the
 * image codes are deliberately not reused: `INVALID_IMAGE_FORMAT` on a video
 * upload would tell a client something untrue about what it sent.
 *
 * ## What is checked, and in what order
 *
 * Cheapest first, so a hostile file is refused before it costs anything:
 *
 * 1. **Bytes.** From what arrived, not from the length the request declared.
 * 2. **The header.** The container is identified from bytes the muxer wrote —
 *    see `video-content.ts`. A PDF, an MP3 or an image renamed to `.mp4` dies
 *    here, having cost 64 bytes.
 * 3. **The probe.** `ffprobe` names the streams, the codecs, the geometry and
 *    the duration. It runs behind a concurrency gate, with a timeout, with its
 *    output bounded, and its child is killed if it overruns.
 * 4. **Header and probe must agree** on the container family. A disagreement
 *    means one of them was fooled.
 * 5. **Exactly one real video stream.** Cover art (`attached_pic`) is not a
 *    video stream and is excluded before counting, or every MP3-with-artwork
 *    and every tagged MP4 would be miscounted.
 * 6. **Geometry, duration and frame rate must be finite and positive.** A
 *    container that reports `N/A` for its duration is malformed, not eternal —
 *    and the duration is read from the probe, never from anything the client
 *    sent.
 * 7. **Codecs against the policy's whitelist**, video and audio.
 * 8. **The policy's budget**: resolution (orientation-aware), duration, frame
 *    rate, bitrate.
 * 9. **A decode near the end of the file.** See {@link assertDecodesToTheEnd}.
 *
 * ## What a client is told
 *
 * One code per axis, and never the decoder's own words. FFmpeg's stderr is
 * written to the log and nothing else: "moov atom not found" is a fact about a
 * demuxer, not advice for whoever picked the file, and forwarding a third-party
 * library's error text to a client is how internal detail leaks.
 */
@Injectable()
export class VideoContentValidationService {
  private readonly logger = new Logger(VideoContentValidationService.name);

  /**
   * Shared by every instance on purpose.
   *
   * The resource being protected is this process's CPU, not one injected
   * object's. Nest gives providers singleton scope so there is one instance in
   * practice, and a `static` says the gate would still hold if that changed.
   */
  private static readonly limiter = new ConcurrencyLimiter(
    VIDEO_PROBE_CONCURRENCY,
    'video validation'
  );

  /** Running and queued counts, for a health endpoint or a log line. */
  public static get pressure(): { running: number; queued: number } {
    return {
      running: VideoContentValidationService.limiter.running,
      queued: VideoContentValidationService.limiter.queued
    };
  }

  /** Read only the header, so an enormous file costs a few bytes to reject. */
  private readHeader(filePath: string): Buffer {
    const handle = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(VIDEO_SNIFF_BYTES);
      const read = fs.readSync(handle, buffer, 0, VIDEO_SNIFF_BYTES, 0);
      return buffer.subarray(0, read);
    } finally {
      fs.closeSync(handle);
    }
  }

  /**
   * Raise one of the policy's rejections.
   *
   * `reason` is written by this service and is safe to show a caller. Anything
   * FFmpeg said goes in `detail`, which is **logged and never returned**.
   */
  private fail(
    code: string,
    policy: VideoUploadPolicy,
    reason: string,
    originalName?: string,
    detail?: string
  ): never {
    const status = policy.statuses[code] || 400;
    this.logger.warn(
      `Rejected upload ${originalName || ''} under ${policy.name}: ${reason} [${code}]`
      + `${detail ? ` — ffmpeg said: ${detail}` : ''}`
    );

    throw new HttpException(
      {
        message: policy.messages[code] || 'That video could not be accepted.',
        error: code,
        statusCode: status,
        reason,
        ...(code === policy.codes.format || code === policy.codes.codec
          ? { supportedContainers: [...policy.allowedContainers] }
          : { limits: policy.limits })
      },
      status
    );
  }

  /**
   * Run a child process, bounded on every axis it could run away on.
   *
   * Time, output size and the process itself: a timeout kills it, a byte cap
   * stops the read, and `stdio: ignore` on stdin means it can never block
   * waiting for input that will not come. Every one of those has been a real way
   * for a media tool to hang a server.
   */
  private runBounded(
    command: string,
    args: string[],
    timeoutMs: number
  ): Promise<ChildResult> {
    return new Promise((resolve) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      } catch (error: any) {
        resolve({ code: null, stdout: '', stderr: String(error?.message || error), timedOut: false });
        return;
      }

      let stdout = '';
      let stderr = '';
      let settled = false;
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        // SIGKILL rather than SIGTERM: the thing being killed is wedged by
        // definition, and a handler it may or may not honour is not a plan. On
        // Windows `kill` maps to TerminateProcess either way.
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }, timeoutMs);
      timer.unref?.();

      const settle = (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code, stdout, stderr, timedOut });
      };

      child.stdout?.on('data', (chunk) => {
        if (stdout.length >= MAX_PROBE_OUTPUT_BYTES) return;
        stdout += chunk.toString();
        if (stdout.length >= MAX_PROBE_OUTPUT_BYTES) {
          // Past the cap the output is unusable anyway, and continuing to read
          // it is the memory problem this cap exists to avoid.
          try { child.kill('SIGKILL'); } catch { /* already gone */ }
        }
      });

      child.stderr?.on('data', (chunk) => {
        if (stderr.length >= MAX_STDERR_BYTES) return;
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        stderr += String(error?.message || error);
        settle(null);
      });

      child.on('close', (code) => settle(code));
    });
  }

  /**
   * Confirm the file at `filePath` is a playable video the policy allows.
   *
   * Throws `HttpException` carrying exactly one of the policy's codes with the
   * status that belongs to it. Never deletes anything — the caller owns the file
   * and knows what else was created alongside it.
   */
  public async assertPlayableVideo(
    filePath: string,
    originalName: string | undefined,
    policy: VideoUploadPolicy
  ): Promise<VerifiedVideo> {
    try {
      return await VideoContentValidationService.limiter.run(
        () => this.verify(filePath, originalName, policy),
        VIDEO_PROBE_QUEUE_TIMEOUT_MS
      );
    } catch (error: any) {
      // A rejection already carrying a code passes through untouched. Only the
      // gate's own timeout lands here, and it is not the file's fault: 503, so a
      // client can retry rather than being told its video is broken.
      if (error instanceof HttpException) throw error;
      this.logger.warn(`Video validation rejected under backpressure: ${error?.message || error}`);
      throw new HttpException(
        {
          message: 'The server is busy processing uploads. Please try again in a moment.',
          error: 'UPLOAD_VALIDATION_BUSY',
          statusCode: 503
        },
        503
      );
    }
  }

  private async verify(
    filePath: string,
    originalName: string | undefined,
    policy: VideoUploadPolicy
  ): Promise<VerifiedVideo> {
    const { limits } = policy;

    if (!filePath || !fs.existsSync(filePath)) {
      this.fail(policy.codes.format, policy, 'the uploaded file is missing', originalName);
    }

    const { size } = fs.statSync(filePath);
    if (!size) this.fail(policy.codes.format, policy, 'the file is empty', originalName);

    // Measured from what arrived, not from the length the request declared.
    // Its own code and a 413: a fine clip saved at too high a bitrate is a
    // different problem from one that is too long or too big on screen.
    if (size > limits.maxBytes) {
      this.fail(
        policy.codes.fileTooLarge,
        policy,
        `the file is ${size} bytes, over the ${limits.maxBytes} byte limit`,
        originalName
      );
    }

    const sniffed = detectVideoContainer(this.readHeader(filePath));
    if (!sniffed) {
      this.fail(
        policy.codes.format,
        policy,
        'the file header is not a supported video container',
        originalName
      );
    }
    if (!policy.allowedContainers.includes(sniffed)) {
      this.fail(
        policy.codes.format,
        policy,
        `${sniffed} is not accepted for a ${policy.name} upload`,
        originalName
      );
    }

    const probe = await this.probe(filePath);
    if (probe.timedOut) {
      this.fail(
        policy.codes.format,
        policy,
        'the video could not be inspected in time',
        originalName,
        'ffprobe timed out'
      );
    }
    if (probe.code !== 0 || !probe.stdout) {
      this.fail(
        policy.codes.format,
        policy,
        'the video container is malformed or unreadable',
        originalName,
        probe.stderr.trim().slice(0, 500)
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(probe.stdout);
    } catch {
      this.fail(
        policy.codes.format,
        policy,
        'the video could not be inspected',
        originalName,
        'ffprobe output was not readable JSON'
      );
    }

    const probedContainer = normaliseProbedContainer(parsed?.format?.format_name);
    if (!probedContainer || !containersAgree(sniffed, probedContainer)) {
      this.fail(
        policy.codes.format,
        policy,
        `the header says ${sniffed} but the container reads as ${probedContainer || 'unknown'}`,
        originalName
      );
    }

    const streams: any[] = Array.isArray(parsed?.streams) ? parsed.streams : [];

    // Cover art is stored as a single-frame video stream. Counting it would make
    // every tagged file look like it had two videos in it, and excluding it is
    // also what stops an audio file with artwork from passing as a video.
    const videoStreams = streams.filter(
      (stream) => stream?.codec_type === 'video' && stream?.disposition?.attached_pic !== 1
    );

    if (videoStreams.length === 0) {
      this.fail(
        policy.codes.format,
        policy,
        'the file has no video stream',
        originalName
      );
    }
    if (videoStreams.length > 1) {
      this.fail(
        policy.codes.format,
        policy,
        `the file carries ${videoStreams.length} video streams; exactly one is expected`,
        originalName
      );
    }

    const video = videoStreams[0];
    const width = Number(video?.width);
    const height = Number(video?.height);

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      this.fail(
        policy.codes.format,
        policy,
        `the video reports no usable dimensions (${video?.width}x${video?.height})`,
        originalName
      );
    }

    // The probe's duration, never the client's. `format.duration` covers the
    // container; a stream duration is the fallback for the muxers that omit it.
    const durationSeconds = Number(parsed?.format?.duration ?? video?.duration);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      this.fail(
        policy.codes.format,
        policy,
        'the video reports no usable duration',
        originalName
      );
    }
    const durationMs = Math.round(durationSeconds * 1000);

    // `avg_frame_rate` is the honest one: `r_frame_rate` is the *base* rate a
    // container advertises and is routinely wrong for variable-rate recordings.
    const frameRate = parseFrameRate(video?.avg_frame_rate) ?? parseFrameRate(video?.r_frame_rate);
    if (frameRate === null) {
      this.fail(
        policy.codes.format,
        policy,
        'the video reports no usable frame rate',
        originalName
      );
    }

    const videoCodec = String(video?.codec_name || '').toLowerCase();
    if (!policy.allowedVideoCodecs.includes(videoCodec)) {
      this.fail(
        policy.codes.codec,
        policy,
        `${videoCodec || 'an unnamed codec'} is not one the pipeline can transcode`,
        originalName
      );
    }

    const audioStream = streams.find((stream) => stream?.codec_type === 'audio');
    const audioCodec = audioStream ? String(audioStream.codec_name || '').toLowerCase() : null;
    if (audioCodec && !policy.allowedAudioCodecs.includes(audioCodec)) {
      this.fail(
        policy.codes.codec,
        policy,
        `the audio track uses ${audioCodec}, which the pipeline cannot transcode`,
        originalName
      );
    }

    // Orientation-aware: a portrait phone recording and the same clip rotated
    // are the same amount of video, and a limit that only understood landscape
    // would refuse every one of them.
    const longEdge = Math.max(width, height);
    const shortEdge = Math.min(width, height);
    if (longEdge > limits.maxWidth || shortEdge > limits.maxHeight) {
      this.fail(
        policy.codes.resolution,
        policy,
        `${width}x${height} is over the ${limits.maxWidth}x${limits.maxHeight} limit`,
        originalName
      );
    }

    if (durationMs > limits.maxDurationMs) {
      this.fail(
        policy.codes.duration,
        policy,
        `the video runs for ${durationMs}ms, over the ${limits.maxDurationMs}ms limit`,
        originalName
      );
    }

    // A small tolerance, because 60fps is muxed as 60000/1001 ≈ 59.94 in some
    // pipelines and as 60.0 in others, and refusing one of those would be
    // enforcing a rounding artefact rather than a limit.
    if (frameRate > limits.maxFrameRate + 0.5) {
      this.fail(
        policy.codes.frameRate,
        policy,
        `${frameRate.toFixed(2)}fps is over the ${limits.maxFrameRate}fps limit`,
        originalName
      );
    }

    const videoBitrate = Number(video?.bit_rate ?? parsed?.format?.bit_rate);
    const bitrate = Number.isFinite(videoBitrate) && videoBitrate > 0 ? videoBitrate : null;
    if (bitrate !== null && bitrate > limits.maxVideoBitrate) {
      this.fail(
        policy.codes.resolution,
        policy,
        `${bitrate}bps is over the ${limits.maxVideoBitrate}bps limit`,
        originalName
      );
    }

    await this.assertDecodesToTheEnd(filePath, durationSeconds, policy, originalName);

    return {
      container: sniffed,
      mimeType: mimeTypeForContainer(sniffed),
      videoCodec,
      audioCodec,
      width,
      height,
      durationMs,
      frameRate,
      videoBitrate: bitrate,
      policy: policy.name
    };
  }

  /** `ffprobe`, as JSON, bounded on time and output. */
  private probe(filePath: string): Promise<ChildResult> {
    return this.runBounded(
      videoConfig.ffprobePath,
      [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        // Bounded analysis. Without these, a file with no early keyframe makes
        // the demuxer read a large prefix looking for one, which is a cheap way
        // to make a probe expensive.
        '-analyzeduration', '10000000',
        '-probesize', '10000000',
        filePath
      ],
      PROBE_TIMEOUT_MS
    );
  }

  /**
   * Decode a frame near the end of the file, and refuse it if none comes out.
   *
   * ## Why the probe is not proof the video exists
   *
   * `ffprobe` reads a header and an index and stops. An MP4 written with
   * `faststart` puts its `moov` at the front, so a file truncated to a third of
   * its length still states a perfectly good 1920x1080 and a full duration —
   * every check above passes, the record is written, and the failure surfaces
   * later in the transcode as a row pointing at a video that was never produced.
   * That is the same trap `assertDecodesCompletely` documents for images, and it
   * is worse here because the transcode runs on a queue, minutes after the
   * uploader has gone.
   *
   * ## Why the end, and only the end
   *
   * Truncation removes the tail by definition, so a frame decoded near the end
   * is the one that proves the payload actually reaches the duration the
   * container claims. Seeking there costs an index lookup rather than a decode
   * of everything before it, so this is a second or two on a file the full
   * transcode would spend minutes on.
   *
   * It is deliberately not presented as a full integrity proof: corruption in
   * the middle of a long clip survives this, and the transcode remains the
   * authority. What it does buy is that the *common* broken upload — a transfer
   * that stopped early — is refused while its uploader is still there to be told.
   *
   * `-xerror` makes FFmpeg exit non-zero on the first decode error rather than
   * logging it and carrying on, which is what turns "it complained" into "it
   * failed".
   */
  private async assertDecodesToTheEnd(
    filePath: string,
    durationSeconds: number,
    policy: VideoUploadPolicy,
    originalName?: string
  ): Promise<void> {
    // Far enough back to land on a keyframe on any sane GOP, and never before
    // the start of a very short clip.
    const seekTo = Math.max(0, durationSeconds - 2);

    const result = await this.runBounded(
      videoConfig.ffmpegPath,
      [
        '-v', 'error',
        '-xerror',
        // Before `-i`, so this is an input seek: FFmpeg jumps using the index
        // instead of decoding everything up to that point.
        '-ss', seekTo.toFixed(3),
        '-i', filePath,
        '-frames:v', '1',
        '-f', 'null',
        '-'
      ],
      TAIL_DECODE_TIMEOUT_MS
    );

    if (result.timedOut) {
      this.fail(
        policy.codes.format,
        policy,
        'the video could not be decoded in time',
        originalName,
        'ffmpeg timed out'
      );
    }

    if (result.code !== 0) {
      this.fail(
        policy.codes.format,
        policy,
        'the video data is incomplete or corrupt',
        originalName,
        result.stderr.trim().slice(0, 500)
      );
    }
  }
}
