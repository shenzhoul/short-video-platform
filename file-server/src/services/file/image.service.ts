import { createHash } from 'crypto';
import { createReadStream, readFileSync } from 'fs';
import * as decodeHeic from 'heic-decode';
import * as sharp from 'sharp';

// libvips keeps recently opened input files in Sharp's file cache. On Windows
// those cached handles make post/discard cleanup fail permanently with EBUSY,
// especially after metadata is read for generated video thumbnails. Disable
// only the file-descriptor cache; memory and operation caching remain enabled.
sharp.cache({ files: 0 });

/**
 * Image Service
 *
 * Specialized service for image processing operations including format conversion,
 * thumbnail generation, EXIF data removal, and support for modern image formats.
 *
 * Key Features:
 * - HEIC/HEIF format support with automatic conversion
 * - Thumbnail generation with aspect ratio preservation
 * - EXIF metadata removal for privacy and file size optimization
 * - Image resizing and optimization
 * - Format conversion (JPEG, PNG, WebP, etc.)
 * - Automatic rotation based on EXIF orientation
 *
 * @example Basic thumbnail creation
 * ```typescript
 * const thumbnail = await imageService.createThumbnail('/path/to/image.jpg', {
 *   width: 300,
 *   height: 200
 * });
 * ```
 *
 * @example HEIC format handling
 * ```typescript
 * const { sharpObj, isHeif } = await imageService.createSharpInstance('/path/to/image.heic');
 * if (isHeif) {
 *   console.log('HEIC format detected and converted');
 * }
 * ```
 */
export class ImageService {
  /**
   * Create Sharp instance with HEIC/HEIF format support
   *
   * Automatically detects and converts HEIC/HEIF images to a format that Sharp can process.
   * This enables support for modern iPhone image formats across the platform.
   * Creates a new Sharp instance optimized for image processing operations.
   *
   * @param filePath - Path to image file or Buffer containing image data
   * @returns Promise resolving to Sharp object and format information
   * @example
   * ```typescript
   * const { sharpObj, isHeif } = await imageService.createSharpInstance(imagePath);
   * const metadata = await sharpObj.metadata();
   * console.log(`Image: ${metadata.width}x${metadata.height}, HEIF: ${isHeif}`);
   * ```
   */

  public async createSharpInstance(filePath: string | Buffer) {
    const obj = sharp(filePath);
    const meta = await obj.metadata();

    // Check if the image is in HEIC/HEIF format
    if (['heif', 'heic'].includes(meta.format) && ['heif', 'heic', 'hevc'].includes(meta.compression)) {
      const decodedImage = await decodeHeic({
        buffer: Buffer.isBuffer(filePath) ? filePath : readFileSync(filePath)
      });

      return {
        sharpObj: sharp(decodedImage.data, {
          raw: {
            width: decodedImage.width,
            height: decodedImage.height,
            channels: 4
          }
        }),
        isHeif: true
      };
    }

    return {
      sharpObj: obj,
      isHeif: false
    };
  }

  /**
   * Remove EXIF data and optimize image
   *
   * Strips EXIF metadata from images for privacy and file size optimization.
   * Handles HEIC/HEIF formats with automatic conversion to JPEG.
   * Preserves animated GIFs while removing metadata.
   *
   * @param filePath - Path to the source image file
   * @param mimeType - MIME type of the source image
   * @returns Promise resolving to optimized image buffer without EXIF data
   * @example
   * ```typescript
   * const cleanImage = await imageService.replaceWithoutExif('/path/to/image.jpg', 'image/jpeg');
   * // Image buffer without EXIF data, ready for storage
   * ```
   */
  public async replaceWithoutExif(filePath: string, mimeType: string) {
    const { sharpObj, isHeif } = await this.createSharpInstance(filePath);
    if (isHeif) {
      return sharpObj
        .rotate()
        .jpeg()
        .toBuffer();
    }

    return sharp(filePath, { animated: mimeType === 'image/gif' })
      .rotate()
      .toBuffer();
  }

  /**
   * Create blurred version of image
   *
   * Generates a low-resolution, blurred version of an image for use as
   * placeholder or preview images. Commonly used for content that requires
   * subscription or payment to view in full quality.
   *
   * @param input - Path to image file or Buffer containing image data
   * @param options - Blur configuration options
   * @param options.sigma - Blur intensity (0.3-1000, default: 10)
   * @param options.width - Output width in pixels (default: 100)
   * @param options.height - Output height in pixels (default: 100)
   * @returns Promise resolving to blurred image buffer in WebP format
   * @example
   * ```typescript
   * const blurredImage = await imageService.blur('/path/to/image.jpg', {
   *   sigma: 15,
   *   width: 200,
   *   height: 150
   * });
   * ```
   */
  public async blur(input: string | Buffer, options = {
    sigma: 6, // a value between 0.3 and 1000 representing the sigma of the Gaussian mask, where sigma = 1 + radius / 2
    width: 100,
    height: 100
  }) {
    let { sigma = 10 } = options;
    const { width = 100, height = 100 } = options;
    if (sigma < 0.3 || sigma > 1000) sigma = 10;

    const { sharpObj } = await this.createSharpInstance(input);
    return sharpObj
      .resize(width, height)
      .blur(sigma)
      .webp({ force: true, quality: 50 })
      .toBuffer();
  }

  /**
     * Generate image thumbnail
     *
     * Generates optimized thumbnail images with automatic aspect ratio preservation.
     * Supports various output formats and can save directly to file or return as buffer.
     * Uses WebP format by default for optimal compression and quality.
     *
     * @param filePath - Path to the source image file
     * @param options - Thumbnail generation options
     * @param options.width - Target width in pixels (null to maintain aspect ratio)
     * @param options.height - Target height in pixels (null to maintain aspect ratio)
     * @param options.toPath - Optional path to save thumbnail file
     * @returns Promise resolving to Buffer (if no toPath) or file path (if toPath provided)
     * @example
     * ```typescript
     * // Generate thumbnail as buffer
     * const thumbnailBuffer = await imageService.generateImageThumbnail('/path/to/image.jpg', {
     *   width: 300,
     *   height: null // Maintain aspect ratio
     * });
     *
     * // Save thumbnail to file
     * await imageService.generateImageThumbnail('/path/to/image.jpg', {
     *   width: 300,
     *   height: 200,
     *   toPath: '/path/to/thumbnail.jpg'
     * });
     * ```
     */
  public async generateImageThumbnail(filePath: string, options?: {
    width?: number;
    height?: number;
    toPath?: string;
  }) {
    // Set default options
    // eslint-disable-next-line no-param-reassign
    options = options || {
      width: 350, // TODO - move to configuration
      height: null
    };

    const { sharpObj } = await this.createSharpInstance(filePath);

    if (options.toPath) {
      return sharpObj
        .resize(options.width, options.height, { fit: 'inside' })
        .rotate() // Auto-rotate based on EXIF
        .webp({
          quality: 85
        })
        .toFile(options.toPath);
    }

    return sharpObj
      .resize(options.width, options.height, { fit: 'inside' })
      .rotate()
      .webp({
        quality: 85
      })
      .toBuffer();
  }

  /**
  * Get image metadata information
  *
  * Extracts comprehensive metadata from image files including dimensions,
  * format, color space, and EXIF data.
  *
  * @param filePath - Path to image file or Buffer containing image data
  * @returns Promise resolving to Sharp metadata object
  * @example
  * ```typescript
  * const metadata = await imageService.getMetaData('/path/to/image.jpg');
  * console.log(`Image: ${metadata.width}x${metadata.height}, Format: ${metadata.format}`);
  * ```
  */
  public async getMetaData(filePath: string | Buffer) {
    return sharp(filePath).metadata();
  }

  /**
   * Generate MD5 hash for a file
   *
   * Creates an MD5 hash of a file for integrity verification and duplicate detection.
   * Uses streaming for memory efficiency with large files.
   *
   * @param filePath - Path to the file to hash
   * @returns Promise resolving to MD5 hash string
   * @example
   * ```typescript
   * const hash = await imageService.generateMD5Hash('/path/to/image.jpg');
   * console.log(`File hash: ${hash}`);
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
}
