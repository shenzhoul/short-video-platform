/**
 * Where uploaded media actually lives.
 *
 * `disk` keeps every byte under `public/` and serves it through
 * `ServeStaticModule` — the only thing local development uses, and the reason
 * nothing here may become required. `r2` puts objects in a Cloudflare R2
 * bucket, which speaks the S3 API, and serves them from a custom domain.
 *
 * The driver chosen here decides where *new* uploads go. It does not decide
 * where existing ones are read from: every file record stores its own
 * `storageType`, and `StorageService` dispatches on that, so switching this
 * value does not strand the media already on disk.
 */
export const STORAGE_DRIVERS = {
  DISK: 'disk',
  R2: 'r2'
} as const;

export type StorageDriver = typeof STORAGE_DRIVERS[keyof typeof STORAGE_DRIVERS];

/**
 * R2 is S3-compatible, so this is deliberately a generic S3 shape — an endpoint,
 * a bucket and a key pair. Pointing it at Backblaze B2 or DigitalOcean Spaces
 * needs no code change, only a different endpoint. What must NOT be done is
 * leaving the endpoint blank and letting the AWS SDK fall back to its global
 * endpoint: that resolves to real AWS, with these credentials attached.
 */
export default {
  driver: (process.env.STORAGE_DRIVER || STORAGE_DRIVERS.DISK) as StorageDriver,

  r2: {
    accountId: process.env.R2_ACCOUNT_ID || '',
    bucket: process.env.R2_BUCKET_NAME || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',

    /**
     * The account's own S3 endpoint —
     * `https://<account id>.r2.cloudflarestorage.com`. Required; there is no
     * default, because every plausible default is an AWS URL.
     */
    endpoint: process.env.R2_ENDPOINT || '',

    /**
     * The origin browsers fetch media from. Prefer an R2 **custom domain**
     * bound to the bucket: it is stable, it is on a domain with a cache policy
     * we control, and it keeps the account id out of every page's HTML. The
     * `*.r2.dev` development URL is rate-limited and explicitly not a
     * production origin.
     *
     * R2 answers `Range` on this origin itself, which is what makes video seek
     * work without the file server sitting in the data path at all.
     */
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL || '',

    /** R2 has one region and it is spelled `auto`. */
    region: process.env.R2_REGION || 'auto',

    /**
     * Namespaces every key this deployment writes. Staging and production
     * should use separate *buckets*; where that is not possible this prefix is
     * the fallback boundary, and it is also what makes the R2 verification
     * script safe to run — it cleans up by exact key under its own prefix.
     */
    keyPrefix: process.env.R2_KEY_PREFIX || ''
  },

  /**
   * `Cache-Control` for uploaded objects.
   *
   * Every key contains a Mongo ObjectId and a UUID and is never rewritten in
   * place, so an object at a given key is immutable and can be cached for a
   * year. Replacing media writes a new key and re-points the document; it does
   * not overwrite the old object.
   */
  cacheControl: process.env.STORAGE_CACHE_CONTROL || 'public, max-age=31536000, immutable',

  /** Lifetime of a presigned GET for a non-public object. */
  signedUrlExpiresInSeconds: parseInt(process.env.STORAGE_SIGNED_URL_TTL_SECONDS || '3600', 10)
};
