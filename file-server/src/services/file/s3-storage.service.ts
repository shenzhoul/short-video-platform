import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { createReadStream, existsSync, promises as fsPromises } from 'fs';
import { chunk, uniq } from 'lodash';
import { extname } from 'path';

import { STORAGE_TYPES } from 'src/common/constants/content';
import {
  IDeleteFileResponse, IFileUpload, IFileUploadResponse, IGetFileUrlOptions
} from 'src/common/interfaces/file';
import { storageConfig } from 'src/config';

import { AbstractStorage } from './abstract-storage';
import { buildPublicObjectUrl, normalizeObjectKey } from './object-key';

/**
 * A bucket-backed storage engine, spoken over the S3 API.
 *
 * Written for Cloudflare R2 and configured through `R2_*`, but there is nothing
 * R2-specific in here beyond the defaults — the endpoint is explicit and the
 * region is whatever the provider wants, so B2, Spaces or MinIO work unchanged.
 *
 * Two things this deliberately does NOT do:
 *
 *  - It does not sit in the data path for reads. Public objects resolve to
 *    `R2_PUBLIC_BASE_URL`, so the browser fetches media straight from the
 *    bucket's custom domain. That is what makes `Range` work for video seeking
 *    — R2 answers `206`/`Content-Range` itself — and it is why streaming a
 *    video does not occupy a Node process.
 *  - It does not overwrite. Keys carry an ObjectId and a UUID and are written
 *    once; replacing media writes a new key and re-points the document.
 */
@Injectable()
export class S3StorageService implements AbstractStorage {
  private readonly logger = new Logger(S3StorageService.name);

  private client: S3Client | null = null;

  /**
   * Built on first use rather than in the constructor.
   *
   * Nest instantiates every provider at boot, including on a disk-storage
   * deployment and in local development where no R2 credentials exist. Failing
   * in the constructor would make the whole file server refuse to start over a
   * backend it was never asked to use.
   */
  private getClient(): S3Client {
    if (this.client) return this.client;

    const {
      endpoint, region, accessKeyId, secretAccessKey, bucket
    } = storageConfig.r2;

    // Fail closed and name the missing variable. An S3 client with no endpoint
    // falls back to the AWS global endpoint and sends these credentials there.
    const missing = Object.entries({
      R2_ENDPOINT: endpoint,
      R2_BUCKET_NAME: bucket,
      R2_ACCESS_KEY_ID: accessKeyId,
      R2_SECRET_ACCESS_KEY: secretAccessKey
    }).filter(([, value]) => !value).map(([name]) => name);

    if (missing.length) {
      throw new Error(
        `Object storage is not configured: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} empty. `
        + 'Refusing to fall back to a default endpoint.'
      );
    }

    this.client = new S3Client({
      region: region || 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      // R2 requires path-style addressing on the S3 endpoint.
      forcePathStyle: true
    });

    return this.client;
  }

  private get bucket(): string {
    return storageConfig.r2.bucket;
  }

  private objectKey(key: string): string {
    return normalizeObjectKey(key, storageConfig.r2.keyPrefix);
  }

  /**
   * Content types the pipeline already knows. This is only a fallback for the
   * `fromFile` path — the caller passes the verified type in every case that
   * went through image or video processing, and that one is authoritative
   * because it was derived from the decoded output rather than from a name.
   */
  private inferContentType(key: string, provided?: string): string {
    if (provided) return provided;

    const byExtension: Record<string, string> = {
      '.webp': 'image/webp',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.avif': 'image/avif',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav'
    };

    return byExtension[extname(key).toLowerCase()] || 'application/octet-stream';
  }

  async writeFile({
    fromFile,
    body,
    key,
    acl = 'public-read',
    contentType,
    rename = false,
    deleteOriginalFile = false
  }: IFileUpload): Promise<IFileUploadResponse> {
    const objectKey = this.objectKey(key);
    const resolvedContentType = this.inferContentType(objectKey, contentType);

    if (!body && !fromFile) {
      throw new Error(`No source provided for object ${objectKey}`);
    }

    if (!body && !existsSync(fromFile)) {
      throw new Error(`File not found ${fromFile}`);
    }

    // A stream rather than a readFile: a 5GB video must not be pulled into the
    // heap to be uploaded. `Upload` promotes to multipart on its own once the
    // body passes the part size, so large media does not depend on a single
    // PUT succeeding.
    const source = body || createReadStream(fromFile);

    try {
      await new Upload({
        client: this.getClient(),
        params: {
          Bucket: this.bucket,
          Key: objectKey,
          Body: source,
          ContentType: resolvedContentType,
          CacheControl: storageConfig.cacheControl
        }
      }).done();
    } catch (error) {
      // The SDK's message can carry request context; the key is the useful part
      // and the credentials never appear in either.
      this.logger.error(`Upload failed for ${objectKey}: ${(error as Error).message}`);
      throw error;
    }

    /*
     * The temp file is removed only after the object is durably in the bucket.
     * The disk engine moves the file, so its callers pass `rename` /
     * `deleteOriginalFile` expecting the source to be gone; leaving it behind
     * here would fill the processing volume one upload at a time. Removing it
     * *before* the upload, on the other hand, would lose the only copy if the
     * upload failed — hence the ordering, and hence the swallowed error: the
     * object exists, so a failure to tidy up is not a reason to fail the write.
     */
    if ((rename || deleteOriginalFile) && fromFile && existsSync(fromFile)) {
      try {
        await fsPromises.unlink(fromFile);
      } catch (error) {
        this.logger.warn(`Uploaded ${objectKey} but could not remove the temp file: ${(error as Error).message}`);
      }
    }

    return {
      path: objectKey,
      absolutePath: objectKey,
      key: objectKey,
      acl,
      storageType: STORAGE_TYPES.S3
    };
  }

  async deleteFile(key: string): Promise<IDeleteFileResponse> {
    if (!key) {
      return { success: true, message: 'No file key provided, nothing to delete' };
    }

    const result = await this.deleteFiles([key]);
    return {
      success: result.success,
      message: result.success ? 'File deleted successfully' : 'File deletion failed',
      errors: result.errors
    };
  }

  async deleteFiles(keys: string[]): Promise<IDeleteFileResponse> {
    const errors: string[] = [];
    let deletedCount = 0;
    let skippedCount = 0;

    const objectKeys: string[] = [];
    uniq(keys).forEach((key) => {
      if (!key) {
        skippedCount += 1;
        return;
      }

      try {
        objectKeys.push(this.objectKey(key));
      } catch (error) {
        // An unusable key cannot name an object, so there is nothing to delete.
        // It is still reported: it means something wrote a key we cannot round-trip.
        errors.push(`${key}: ${(error as Error).message}`);
        skippedCount += 1;
      }
    });

    if (!objectKeys.length) {
      return {
        success: errors.length === 0, deletedCount, skippedCount, errors: errors.length ? errors : undefined
      };
    }

    // DeleteObjects takes at most 1000 keys per call.
    for (const batch of chunk(uniq(objectKeys), 1000)) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await this.getClient().send(new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true }
        }));

        /*
         * A 200 from DeleteObjects does not mean every key was deleted — per-key
         * failures come back in the body. Treating the call's status as the
         * answer is how an object survives a delete and becomes an orphan
         * nothing will collect, because the record that referenced it is gone.
         */
        const failures = response.Errors || [];
        failures.forEach((failure) => {
          errors.push(`${failure.Key}: ${failure.Code} ${failure.Message}`);
        });

        deletedCount += batch.length - failures.length;
        skippedCount += failures.length;
      } catch (error) {
        this.logger.error(`Batch delete failed for ${batch.length} objects: ${(error as Error).message}`);
        errors.push(`batch of ${batch.length}: ${(error as Error).message}`);
        skippedCount += batch.length;
      }
    }

    return {
      success: errors.length === 0,
      deletedCount,
      skippedCount,
      errors: errors.length ? errors : undefined
    };
  }

  /**
   * Whether an object is actually in the bucket.
   *
   * Used by the verification script and by any caller that must not mark a file
   * `ready` on the strength of an upload call having returned.
   */
  async objectExists(key: string): Promise<boolean> {
    try {
      await this.getClient().send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key)
      }));
      return true;
    } catch (error) {
      const status = (error as any)?.$metadata?.httpStatusCode;
      if (status === 404 || (error as Error).name === 'NotFound') return false;
      throw error;
    }
  }

  async getFileUrl(key: string, options?: IGetFileUrlOptions): Promise<string> {
    const { authenticated, expiresIn } = options || {};
    const objectKey = this.objectKey(key);

    /*
     * Public objects get the plain custom-domain URL — no signature, no query
     * string. That is not only simpler: a signed URL is uncacheable in practice
     * because the signature changes on every render, so signing public media
     * would defeat both the CDN and the browser cache for every image on the
     * page.
     */
    if (!authenticated) {
      const { publicBaseUrl } = storageConfig.r2;
      if (!publicBaseUrl) {
        throw new Error('R2_PUBLIC_BASE_URL is not configured; cannot build a public media URL.');
      }
      return buildPublicObjectUrl(publicBaseUrl, objectKey);
    }

    return getSignedUrl(
      this.getClient(),
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      { expiresIn: expiresIn || storageConfig.signedUrlExpiresInSeconds }
    );
  }
}
