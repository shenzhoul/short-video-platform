import { Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import * as ffmpeg from 'fluent-ffmpeg';
import { cpus } from 'os';
import { createReadStream, statSync, unlinkSync } from 'fs';
import { join, normalize } from 'path';
import { ConvertMp4ErrorException } from 'src/common/exeptions/file';
import { videoConfig } from 'src/config';
import { StringHelper } from 'src/kernel';
import { getExt } from 'src/kernel/helpers/string.helper';
import { exec, spawn } from 'child_process';

/** Hardware acceleration types supported by FFmpeg */
export type HardwareAccelType = 'nvidia' | 'amd' | 'intel' | 'vaapi' | 'qsv' | 'cpu';

/** Detected hardware acceleration info */
export interface HardwareAccelInfo {
  type: HardwareAccelType;
  name: string;
  supported: boolean;
  encoderName: string; // e.g. 'h264_nvenc', 'h264_amf', 'hevc_vaapi'
  quality: 'high' | 'medium' | 'low';
}

/** FFmpeg encoder options determined by hardware capability */
export interface EncoderOptions {
  videoCodec: string;
  audioCodec: string;
  extraArgs: string[];
  isHardware: boolean;
  preset?: string; // Only for CPU encoding
  threads?: number;
}

export interface IConvertOptions {
  toPath?: string;
  size?: string; // https://github.com/fluent-ffmpeg/node-fluent-ffmpeg#video-frame-size-options
}

export interface IConvertResponse {
  fileName: string;
  toPath: string;
}

/**
 * File Video Service
 *
 * Specialized service for video processing operations including format conversion,
 * thumbnail generation, and HTML5 compatibility checking. Uses FFmpeg for all
 * video processing operations with optimized settings for web delivery.
 *
 * Key Features:
 * - MP4 conversion with H.264 encoding for broad compatibility
 * - Automatic resolution scaling based on configuration limits
 * - Thumbnail extraction from video frames
 * - HTML5 video format compatibility detection
 * - Multi-threaded processing with CPU optimization
 * - Fallback conversion strategies for problematic files
 *
 * Requirements:
 * - FFmpeg 4.x or newer installed on the system
 * - Sufficient disk space for temporary files during conversion
 * - CPU resources for video encoding operations
 *
 * @example Basic video conversion
 * ```typescript
 * const result = await videoService.convert2Mp4('/path/to/video.mov');
 * console.log(`Converted to: ${result.toPath}`);
 * ```
 *
 * @example Thumbnail generation
 * ```typescript
 * const thumbnails = await videoService.createThumbs('/path/to/video.mp4', {
 *   toFolder: '/thumbnails',
 *   count: 5,
 *   size: '640x360'
 * });
 * ```
 */
export class FileVideoService {
  private readonly logger = new Logger(FileVideoService.name);

  private _hwAccel: HardwareAccelInfo | null = null;

  private _cpuModel: string | null = null;

  /**
   * Creates thumbnail images from a video file using direct FFmpeg commands.
   * @param {string} filePath - The path to the video file.
   * @param {object} options - Thumbnail creation options.
   * @param {string} options.toFolder - The folder to save the thumbnails in.
   * @param {number} [options.count=3] - The number of thumbnails to create.
   * @param {string} [options.size='480x?'] - The size of the thumbnails.
   * @returns {Promise<string[]>} A promise that resolves to an array of thumbnail filenames.
   */
  public async createThumbs(filePath: string, options: {
    toFolder: string;
    count?: number;
    size?: string;
  }): Promise<string[]> {
    const fallbackStrategies = [
      { format: 'webp', description: 'WebP with explicit codec' },
      { format: 'jpg', description: 'JPEG fallback' },
      { format: 'png', description: 'PNG fallback' }
    ];

    let lastError: Error | null = null;

    for (let i = 0; i < fallbackStrategies.length; i++) {
      const strategy = fallbackStrategies[i];

      try {
        this.logger.debug(`Attempting thumbnail generation with ${strategy.description} (strategy ${i + 1}/${fallbackStrategies.length})`);

        if (strategy.format === 'webp') {
          // Try WebP with enhanced command strategies
          return await this.createThumbsWithWebPStrategies(filePath, options);
        } else {
          // Try JPEG or PNG with standard approach
          return await this.createThumbsDirectCommand(filePath, options, strategy.format);
        }

      } catch (error) {
        lastError = error;
        const isLastStrategy = i === fallbackStrategies.length - 1;

        if (isLastStrategy) {
          this.logger.error(`All thumbnail generation strategies failed. Last error: ${error.message}`);
          throw new Error(`Failed to generate thumbnails with all strategies. Last error: ${error.message}`);
        } else {
          this.logger.warn(`${strategy.description} failed: ${error.message}. Trying next strategy...`);
          continue;
        }
      }
    }

    // This should never be reached, but just in case
    throw lastError || new Error('Unknown error occurred during thumbnail generation');
  }

  /**
   * Tries multiple WebP command strategies with different codec options
   * @private
   */
  private async createThumbsWithWebPStrategies(filePath: string, options: {
    toFolder: string;
    count?: number;
    size?: string;
  }): Promise<string[]> {
    const { toFolder, count = 3, size = '480x?' } = options;

    // Get video metadata to calculate timestamp intervals
    const metadata = await this.getMetaData(filePath);
    const duration = metadata.format.duration || 30;

    // WebP command strategies to try in order
    const webpStrategies = [
      { name: 'libwebp codec', options: ['-c:v', 'libwebp'] },
      { name: 'libwebp with quality', options: ['-c:v', 'libwebp', '-quality', '80'] },
      { name: 'libwebp with compression', options: ['-c:v', 'libwebp', '-compression_level', '6'] },
      { name: 'image2 format only', options: ['-f', 'image2'] },
      { name: 'auto format detection', options: [] }
    ];

    // Generate all requested recommendations, including for short videos.
    const interval = duration / (count + 1);

    for (let strategyIndex = 0; strategyIndex < webpStrategies.length; strategyIndex++) {
      const strategy = webpStrategies[strategyIndex];
      const tempThumbnailFiles: string[] = [];
      const scaleFilter = size.replace('x?', ':-1').replace('?x', '-1:');

      try {
        // Try to generate all thumbnails with current strategy
        for (let i = 1; i <= count; i++) {
          const calculatedTimestamp = interval * i;
          const edgeBuffer = Math.min(0.1, Math.max(duration * 0.05, 0.01));
          const timestamp = Math.max(Math.min(calculatedTimestamp, duration - edgeBuffer), edgeBuffer);
          const filename = `${StringHelper.randomString(5)}-${i}.webp`;
          const outputPath = join(toFolder, filename);

          const command = [
            this.escapeFilePath(videoConfig.ffmpegPath),
            '-i', this.escapeFilePath(filePath),
            '-vf', `scale=${scaleFilter}`,
            '-frames:v', '1',
            '-ss', timestamp.toString(),
            ...strategy.options,
            '-y',
            this.escapeFilePath(outputPath)
          ].join(' ');

          this.logger.debug(`WebP Strategy ${strategyIndex + 1}/${webpStrategies.length} (${strategy.name}) thumbnail ${i}/${count}: ${command}`);
          await this.runCommand(command);
          tempThumbnailFiles.push(filename);
        }

        // If we reach here, all thumbnails were generated successfully
        this.logger.debug(`WebP Strategy ${strategyIndex + 1} (${strategy.name}) succeeded for all thumbnails`);
        return tempThumbnailFiles;

      } catch (error) {
        this.logger.debug(`WebP Strategy ${strategyIndex + 1} (${strategy.name}) failed: ${error.message}`);

        // Clean up any partially created files
        for (const partialFile of tempThumbnailFiles) {
          try {
            const partialPath = join(toFolder, partialFile);
            if (statSync(partialPath)) {
              unlinkSync(partialPath);
            }
          } catch {
            // Ignore cleanup errors
          }
        }

        // If this is the last strategy, throw the error
        if (strategyIndex === webpStrategies.length - 1) {
          throw error;
        }
      }
    }

    throw new Error('All WebP strategies failed');
  }

  /**
   * Creates thumbnail images using direct FFmpeg commands.
   * @param {string} filePath - The path to the video file.
   * @param {object} options - Thumbnail creation options.
   * @param {string} format - Image format (webp, jpg, png)
   * @returns {Promise<string[]>} A promise that resolves to an array of thumbnail filenames.
   * @private
   */
  private async createThumbsDirectCommand(filePath: string, options: {
    toFolder: string;
    count?: number;
    size?: string;
  }, format: string): Promise<string[]> {
    const { toFolder, count = 3, size = '480x?' } = options;

    // Get video metadata to calculate timestamp intervals
    const metadata = await this.getMetaData(filePath);
    const duration = metadata.format.duration || 30;

    const thumbnailFiles: string[] = [];
    const interval = duration / (count + 1);

    // Generate thumbnails at evenly spaced intervals
    for (let i = 1; i <= count; i++) {
      // Ensure timestamp doesn't exceed video duration and isn't too close to the end
      const calculatedTimestamp = interval * i;
      const edgeBuffer = Math.min(0.1, Math.max(duration * 0.05, 0.01));
      const timestamp = Math.max(Math.min(calculatedTimestamp, duration - edgeBuffer), edgeBuffer);

      const filename = `${StringHelper.randomString(5)}-${i}.${format}`;
      const outputPath = join(toFolder, filename);
      const scaleFilter = size.replace('x?', ':-1').replace('?x', '-1:');

      const command = [
        this.escapeFilePath(videoConfig.ffmpegPath),
        '-i', this.escapeFilePath(filePath),
        '-vf', `scale=${scaleFilter}`,
        '-frames:v', '1',
        '-ss', timestamp.toString(),
        '-f', 'image2',
        '-y',
        this.escapeFilePath(outputPath)
      ].join(' ');

      this.logger.debug(`Generating thumbnail ${i}/${count} at ${timestamp}s: ${command}`);
      await this.runCommand(command);
      thumbnailFiles.push(filename);
    }

    return thumbnailFiles;
  }

  // ─── Video conversion ──────────────────────────────────────────────────────

  /**
   * Converts a video file to MP4 format with a fallback strategy.
   *
   * The primary strategy attempts to re-encode the video using libx264, which is highly compatible.
   * If the primary conversion fails, a fallback strategy is used to re-mux the video stream without
   * re-encoding, which can fix container issues for videos with already compatible codecs.
   *
   * Recommended FFMPEG version: 4.x or newer.
   *
   * @param {string} filePath - The path to the input video file.
   * @param {IConvertOptions} options - Conversion options, including `toPath` and `size`.
   * @returns {Promise<IConvertResponse>} A promise that resolves to an object containing the new `fileName` and `toPath`.
   * @throws {ConvertMp4ErrorException} on conversion failure with both primary and fallback methods.
   */
  public async convert2Mp4(
    filePath: string,
    options = {} as IConvertOptions
  ): Promise<IConvertResponse> {
    const fileName = `${StringHelper.randomString(5)}_${StringHelper.getFileName(filePath, true)}.mp4`;
    const toPath = options.toPath || join(StringHelper.getFilePath(filePath), fileName);

    try {
      // Resolve the best encoder for this machine (GPU if available, CPU with optimised preset otherwise).
      // Detection result is cached after the first call — zero per-video overhead.
      const metadata = await this.getMetaData(filePath);
      const videoStream = metadata.streams.find((s: any) => s.codec_type === 'video');
      const audioStream = metadata.streams.find((s: any) => s.codec_type === 'audio');

      if (!videoStream) {
        throw new Error('No video stream found in the input file');
      }

      const { width, height } = videoStream;
      const sourceBitrate = Number(videoStream.bit_rate || metadata.format?.bit_rate || 0);
      const maximumBitrateKbps = videoConfig.conversion.maxBitrate;
      const targetVideoBitrateKbps = sourceBitrate > 0
        ? Math.min(maximumBitrateKbps, Math.max(300, Math.ceil((sourceBitrate / 1000) * 1.5)))
        : Math.min(maximumBitrateKbps, 2500);
      const encoder = await this.getEncoderOptions(targetVideoBitrateKbps);

      // Build FFmpeg arguments using the auto-detected encoder.
      const args: string[] = [
        '-f', 'mp4',
        '-vcodec', encoder.videoCodec,
        ...encoder.extraArgs
      ];

      // Only enable multi-threading when explicitly configured, to avoid starving other processes.
      if (encoder.threads) {
        args.push('-threads', String(encoder.threads));
      }

      // Audio: copy if AAC, otherwise re-encode to AAC.
      if (audioStream) {
        if (audioStream.codec_name === 'aac') {
          args.push('-acodec', 'copy');
        } else {
          args.push('-acodec', 'aac', '-b:a', '128k');
        }
      } else {
        args.push('-an');
      }

      // Scale down if the video exceeds configured resolution limits.
      if (width > videoConfig.maxResolution.width || height > videoConfig.maxResolution.height) {
        args.push(
          '-vf',
          `scale=min(${videoConfig.maxResolution.width},iw):min(${videoConfig.maxResolution.height},ih):force_original_aspect_ratio=decrease`
        );
      } else if (options.size) {
        const [newWidth] = options.size.split('x');
        args.push('-vf', `scale=${newWidth}:-1`);
      }

      args.push('-hide_banner', '-y');

      // Build the command string for logging and execution.
      const cmdParts = args.map((a) => this.escapeFilePath(a));
      const primaryCommand = `${this.escapeFilePath(videoConfig.ffmpegPath)} -i ${this.escapeFilePath(filePath)} ${cmdParts.join(' ')} ${this.escapeFilePath(toPath)}`;

      this.logger.log(
        `[convert2Mp4] encoder=${encoder.videoCodec} hw=${encoder.isHardware} preset=${encoder.preset || 'n/a'} targetBitrate=${targetVideoBitrateKbps}k | ${primaryCommand}`
      );
      await this.runCommand(primaryCommand);

      return { fileName, toPath };
    } catch (primaryError) {
      this.logger.warn(`Primary conversion failed: ${primaryError.message}. Attempting fallback (re-mux)…`);

      try {
        // Fallback: re-mux streams without re-encoding — fixes container-level issues.
        const fallbackArgs = [
          '-f', 'mp4',
          '-c:v', 'copy',
          '-c:a', 'copy',
          '-movflags', '+faststart',
          '-hide_banner',
          '-y'
        ].join(' ');

        const fallbackCommand = `${this.escapeFilePath(videoConfig.ffmpegPath)} -i ${this.escapeFilePath(filePath)} ${fallbackArgs} ${this.escapeFilePath(toPath)}`;

        this.logger.log(`[convert2Mp4] fallback: ${fallbackCommand}`);
        await this.runCommand(fallbackCommand);

        return { fileName, toPath };
      } catch (fallbackError) {
        this.logger.error(
          `Both primary and fallback conversion failed. Primary: ${primaryError.message}. Fallback: ${fallbackError.message}`
        );
        throw new ConvertMp4ErrorException(
          `Failed to convert video with both primary and fallback methods. Primary error: ${primaryError.message}. Fallback error: ${fallbackError.message}`
        );
      }
    }
  }

  /**
   * Executes an FFMPEG command using spawn.
   * @param {string} commandString - The FFMPEG command to execute.
   * @returns {Promise<void>} A promise that resolves on successful execution or rejects on failure.
   * @private
   */
  private runCommand(commandString: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Parse command string into command and arguments for better reliability
      const parts = commandString.split(' ');
      const command = parts[0];
      const args = parts.slice(1);

      const ffmpegProcess = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      ffmpegProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ffmpegProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpegProcess.on('error', (error) => {
        this.logger.error(`FFmpeg process error: ${error.message}`);
        reject(new Error(`FFmpeg process failed to start: ${error.message}`));
      });

      ffmpegProcess.on('exit', (code, signal) => {
        if (code === 0) {
          this.logger.debug('FFmpeg completed successfully');
          resolve();
        } else {
          const errorMessage = stderr || stdout || `FFmpeg exited with code ${code}`;
          this.logger.error(`FFmpeg failed with exit code ${code}. Signal: ${signal}. Error: ${errorMessage}`);
          reject(new Error(`ffmpeg exited with code ${code}: ${errorMessage}`));
        }
      });
    });
  }

  /**
     * Checks if a video is in a format compatible with HTML5 playback in modern browsers.
     * @param {string} filePath - The path to the video file.
     * @returns {Promise<boolean>} A promise that resolves to `true` if the video is compatible, otherwise `false`.
     */
  public async isSupportHtml5(filePath: string): Promise<boolean> {
    const ext = getExt(filePath)?.toLowerCase();
    if (!['.mp4', '.webm', '.ogg'].includes(ext)) {
      return false;
    }

    const meta = await this.getMetaData(filePath);
    if (!meta || !meta.streams || meta.streams.length === 0) {
      return false;
    }

    const videoStream = meta.streams.find((s: any) => s.codec_type === 'video');
    const audioStream = meta.streams.find((s: any) => s.codec_type === 'audio');

    if (!videoStream) {
      return false;
    }

    switch (ext) {
      case '.mp4':
        // The yuv420p pixel format is the most widely supported for H.264, but many modern browsers
        // can handle other formats. We are removing this check to be more flexible.
        return videoStream.codec_name === 'h264' && (!audioStream || audioStream.codec_name === 'aac');
      case '.webm':
        return (
          ['vp8', 'vp9'].includes(videoStream.codec_name)
          && (!audioStream || ['vorbis', 'opus'].includes(audioStream.codec_name))
        );
      case '.ogg':
        return videoStream.codec_name === 'theora' && (!audioStream || audioStream.codec_name === 'vorbis');
      default:
        return false;
    }
  }

  /**
     * Retrieves video metadata using ffprobe.
     * @param {string} filePath - The path to the video file.
     * @returns {Promise<ffmpeg.FfprobeData>} A promise that resolves with the video's metadata.
     */
  public getMetaData(filePath: string): Promise<ffmpeg.FfprobeData> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err: any, metadata: ffmpeg.FfprobeData) => {
        if (err) {
          return reject(err);
        }
        return resolve(metadata);
      });
    });
  }

  /**
   * Escapes file paths for cross-platform command execution
   * Handles spaces and special characters in file paths
   * @param filePath - The file path to escape
   * @returns Properly escaped file path for command execution
   * @private
   */
  private escapeFilePath(filePath: string): string {
    // First convert to platform-specific path if it's a POSIX path from DB
    const platformPath = this.toPlatformPath(filePath);
    // Then normalize path separators for the current platform
    const normalizedPath = normalize(platformPath);

    // On Windows, wrap paths with spaces in double quotes
    // On Unix-like systems, escape spaces with backslashes
    if (process.platform === 'win32') {
      // Windows: use double quotes if path contains spaces or special characters
      return normalizedPath.includes(' ') || /[&<>|^]/.test(normalizedPath)
        ? `"${normalizedPath}"`
        : normalizedPath;
    } else {
      // Unix-like: escape spaces and special characters
      return normalizedPath.replace(/[ &<>|^()$`\\";'*?[\]{}~]/g, '\\$&');
    }
  }

  /**
  * Converts POSIX paths from database to platform-specific paths
  * Since paths are stored in POSIX format in the database, this function
  * converts them to the appropriate format for the current platform
  * @param posixPath - The POSIX path from database
  * @returns Platform-specific path
  * @private
  */
  private toPlatformPath(posixPath: string): string {
    if (!posixPath) return '';

    // On Windows, convert forward slashes to backslashes
    if (process.platform === 'win32') {
      return posixPath.replace(/\//g, '\\');
    }

    // On Unix-like systems, keep as-is (already POSIX)
    return posixPath;
  }

  /**
   * Generate MD5 hash for a video file
   *
   * Creates an MD5 hash of a video file for integrity verification and duplicate detection.
   * Uses streaming for memory efficiency with large files.
   *
   * @param filePath - Path to the video file to hash
   * @returns Promise resolving to MD5 hash string
   * @example
   * ```typescript
   * const hash = await videoService.generateMD5Hash('/path/to/video.mp4');
   * console.log(`Video hash: ${hash}`);
   * ```
   */
  public async generateMD5Hash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('md5');
      const stream = createReadStream(filePath);

      stream.on('data', (data) => {
        hash.update(data as any);
      });

      stream.on('end', () => {
        resolve(hash.digest('hex'));
      });

      stream.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Returns the optimal FFmpeg encoder options for the current hardware.
   * GPU encoders are used when available; otherwise a CPU-optimised preset is selected.
   * For AMD CPUs the preset is bumped to 'veryfast' for better performance.
   */
  private async getEncoderOptions(targetVideoBitrateKbps: number): Promise<EncoderOptions> {
    const hw = await this.detectHardwareAcceleration();
    const bitrateArgs = [
      '-b:v', `${targetVideoBitrateKbps}k`,
      '-maxrate', `${targetVideoBitrateKbps}k`,
      '-bufsize', `${targetVideoBitrateKbps * 2}k`
    ];

    if (hw.type !== 'cpu') {
      return {
        videoCodec: hw.encoderName,
        audioCodec: 'aac',
        extraArgs: [
          '-preset', 'fast',
          ...bitrateArgs,
          '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart'
        ],
        isHardware: true
      };
    }

    const cpuModel = this.detectCpuModel();
    const isAmd = /amd|ryzen|epyc|athlon/i.test(cpuModel);
    const preset = isAmd ? 'veryfast' : (videoConfig.performance.preset || 'fast');

    this.logger.debug(`CPU encoding — model: "${cpuModel}", preset: ${preset}, isAmd: ${isAmd}`);

    return {
      videoCodec: 'libx264',
      audioCodec: 'aac',
      extraArgs: [
        '-preset', preset,
        '-crf', '23',
        ...bitrateArgs,
        '-pix_fmt', 'yuv420p',
        '-profile:v', 'baseline',
        '-level', '3.1',
        '-movflags', '+faststart'
      ],
      isHardware: false,
      preset,
      threads: videoConfig.performance.maxThreads ? this.getThreadsLimit() : undefined
    };
  }

  /**
  * Calculates the number of threads to use for FFMPEG based on CPU cores and environment settings.
  * @returns {number} The number of threads to use.
  * @private
  */
  private getThreadsLimit(): number {
    const cpuCount = cpus().length;
    const defaultNum = Math.ceil(cpuCount / 2);

    if (process.env.FFMPEG_CPU_LIMIT) {
      const num = parseInt(process.env.FFMPEG_CPU_LIMIT, 10);
      if (num > cpuCount) return defaultNum;
      if (num < 1) return 1;
      return num;
    }
    return defaultNum;
  }

  // ─── Hardware detection helpers (placed here to satisfy @typescript-eslint/member-ordering) ──

  /**
   * Runs FFmpeg -encoders to discover available hardware accelerators.
   * Results are cached after the first call so there is zero per-video overhead.
   */
  private async detectHardwareAcceleration(): Promise<HardwareAccelInfo> {
    if (this._hwAccel) return this._hwAccel;

    if (process.env.VIDEO_DISABLE_HWACCEL === 'true') {
      this.logger.log('Hardware acceleration disabled via VIDEO_DISABLE_HWACCEL=true — using CPU encoding');
      this._hwAccel = { type: 'cpu', name: 'CPU (software)', supported: true, encoderName: 'libx264', quality: 'medium' };
      return this._hwAccel;
    }

    const encoders = await this.runCommandCapture(`${videoConfig.ffmpegPath} -hide_banner -encoders 2>&1`);

    const hwCandidates: Array<{ type: HardwareAccelType; pattern: RegExp; name: string; encoder: string }> = [
      { type: 'nvidia', pattern: /^V..... h264_nvenc/, name: 'NVIDIA NVENC H.264', encoder: 'h264_nvenc' },
      { type: 'nvidia', pattern: /^V..... hevc_nvenc/, name: 'NVIDIA NVENC HEVC', encoder: 'hevc_nvenc' },
      { type: 'amd', pattern: /^V..... h264_amf/, name: 'AMD AMF H.264', encoder: 'h264_amf' },
      { type: 'amd', pattern: /^V..... hevc_amf/, name: 'AMD AMF HEVC', encoder: 'hevc_amf' },
      { type: 'vaapi', pattern: /^V..... h264_vaapi/, name: 'VA-API H.264', encoder: 'h264_vaapi' },
      { type: 'vaapi', pattern: /^V..... hevc_vaapi/, name: 'VA-API HEVC', encoder: 'hevc_vaapi' },
      { type: 'qsv', pattern: /^V..... h264_qsv/, name: 'Intel QSV H.264', encoder: 'h264_qsv' },
      { type: 'qsv', pattern: /^V..... hevc_qsv/, name: 'Intel QSV HEVC', encoder: 'hevc_qsv' }
    ];

    for (const candidate of hwCandidates) {
      if (candidate.pattern.test(encoders)) {
        const info: HardwareAccelInfo = { type: candidate.type, name: candidate.name, supported: true, encoderName: candidate.encoder, quality: 'medium' };
        this.logger.log(`Hardware acceleration detected: ${candidate.name} (encoder: ${candidate.encoder})`);
        this._hwAccel = info;
        return info;
      }
    }

    this.logger.log('No hardware encoder detected — using CPU (libx264)');
    this._hwAccel = { type: 'cpu', name: 'CPU (software)', supported: true, encoderName: 'libx264', quality: 'medium' };
    return this._hwAccel;
  }

  /**
   * Reads /proc/cpuinfo (Linux) or uses wmic (Windows) to identify the CPU model family.
   * Used to apply AMD-specific preset tuning when GPU encoding is unavailable.
   */
  private detectCpuModel(): string {
    if (this._cpuModel) return this._cpuModel;

    try {
      if (process.platform === 'win32') {
        const result = require('child_process').execSync('wmic cpu get Name', { encoding: 'utf8', timeout: 5000 });
        const match = result.match(/AMD Ryzen|Intel Core|i[3579]-\d{4}/i);
        this._cpuModel = match ? match[0].trim() : 'unknown';
      } else {
        const data = require('fs').readFileSync('/proc/cpuinfo', 'utf8');
        const modelMatch = data.match(/model name\s*:\s*(.+)/m);
        this._cpuModel = modelMatch ? modelMatch[1].trim() : 'unknown';
      }
    } catch {
      this._cpuModel = 'unknown';
    }

    this.logger.debug(`Detected CPU model: ${this._cpuModel}`);
    return this._cpuModel;
  }

  /**
  * Runs a shell command and captures its stdout synchronously.
  * Used only during one-time hardware detection at startup.
  */
  private runCommandCapture(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(command, { timeout: 10000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve(stdout);
      });
    });
  }
}
