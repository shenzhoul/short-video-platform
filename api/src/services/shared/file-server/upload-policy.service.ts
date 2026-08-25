import {
  allUploadLimitSettingKeys,
  getUploadPolicy,
  resolveEffectiveUploadPolicy,
  UPLOAD_LIMIT_FIELDS,
  UPLOAD_POLICIES,
  UploadPolicy
} from '@douyin-clone/upload-policy';
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

import {
  UnsupportedUploadTypeException,
  UploadFileTooLargeException
} from 'src/common/exceptions/upload/invalid-upload.exception';
import { SettingService } from 'src/services/system/setting/setting.service';

/**
 * The API's gate in front of every upload URL it issues.
 *
 * ## Why the API checks at all, when the file server enforces
 *
 * Three reasons, and none of them is "so the file server can skip a check":
 *
 * 1. **A record is created before a byte moves.** `generateTusUploadUrl` writes
 *    a pending `File` document and signs a token for it. Issuing one for a type
 *    nothing governs means creating a row the sweeper may not know about, for an
 *    upload nothing will validate.
 * 2. **The declared size is free to check.** Refusing an 80MB avatar here costs
 *    one small request; letting it through costs the whole transfer before the
 *    file server can weigh what arrived.
 * 3. **`publicUpload: false` has to be enforced somewhere a client can reach.**
 *    The file server's internal API is behind a guard the browser cannot call,
 *    so the only place a client's request for an internal-only type can be
 *    turned down is here.
 *
 * ## What this is not
 *
 * It is not the authority. Every number it reads is a claim in a request body —
 * `fileSize` is whatever the client typed — and the file server measures the
 * bytes that actually arrive under the same policy. Nothing here entitles a
 * later check to be skipped, and the runtime harness proves both run.
 *
 * ## Failing closed
 *
 * An unregistered type is refused rather than issued with no policy. That is the
 * whole point of the registry: `post-phto` must not quietly become a wider
 * upload than `post-photo`, and a type somebody forgot to add must surface as a
 * loud 400 rather than as an unvalidated file on disk.
 *
 * ## Where the numbers come from now
 *
 * `shared/upload-policy` still holds the defaults, and they are still what a
 * blank database uses. On top of them, an operator can adjust some of the
 * numbers from Admin → Settings → Upload limits, and those overrides live in the
 * ordinary settings collection.
 *
 * They are read from `SettingService`'s in-memory cache, which is refreshed on
 * every write and fanned out to other instances over Redis pub/sub — so a Save
 * reaches the next upload without a restart, and without this service knowing
 * anything about how that happens.
 *
 * A missing, unparseable or out-of-range override falls back to the code
 * default, field by field. That is what makes an empty settings collection, a
 * half-migrated one and a hand-edited one all behave sensibly.
 */
@Injectable()
export class UploadPolicyService {
  private readonly logger = new Logger(UploadPolicyService.name);

  constructor(
    // `forwardRef` because `SettingService` reaches `FileServerService`, which
    // sits in this same module graph. The cycle is between modules rather than
    // between these two classes, and Nest needs to be told so.
    @Inject(forwardRef(() => SettingService))
    private readonly settingService: SettingService
  ) { }

  /**
   * Every upload-limit override currently stored, keyed by settings key.
   *
   * Read from the cache rather than the database: this runs on the path that
   * issues an upload URL, and a database round trip per upload to fetch
   * fifty-seven numbers that change once a month would be a poor trade. The
   * cache is authoritative in the only sense that matters — it is updated
   * synchronously on write and by pub/sub everywhere else.
   */
  private storedOverrides(): Record<string, any> {
    try {
      return this.settingService.getPublicValueByKeys(allUploadLimitSettingKeys());
    } catch (error) {
      // A cache that is not ready yet (very early boot) must not stop uploads.
      // Defaults are known good and are exactly what this would fall back to.
      this.logger.warn(`Could not read upload limit settings, using defaults: ${error?.message || error}`);
      return {};
    }
  }

  /**
   * The policy in force for a type right now, defaults plus any overrides.
   *
   * Returns `null` for a type the registry does not know — the caller turns that
   * into `UNSUPPORTED_UPLOAD_TYPE`, never into "no limits".
   */
  public effectivePolicy(type: string): UploadPolicy | null {
    return resolveEffectiveUploadPolicy(type, this.storedOverrides());
  }

  /**
   * Every registered type's effective policy, for the web app to read once.
   *
   * The overrides are fetched a single time and reused across all ten types, so
   * this is one cache read rather than ten.
   */
  public allEffectivePolicies(): Record<string, UploadPolicy> {
    const overrides = this.storedOverrides();
    const policies: Record<string, UploadPolicy> = {};
    for (const type of Object.keys(UPLOAD_POLICIES)) {
      const policy = resolveEffectiveUploadPolicy(type, overrides);
      if (policy) policies[type] = policy;
    }
    return policies;
  }

  /**
   * The limits to hand the file server when it creates the pending record.
   *
   * Sent as plain numbers rather than as a policy, because the file server has
   * its own copy of the registry and only needs to be told which numbers moved.
   * Stored on the durable record, which is what gives an in-flight upload the
   * policy that was in force when its token was issued: an admin lowering a
   * limit mid-transfer does not retroactively refuse a file somebody is already
   * two hundred megabytes into sending.
   */
  public limitsForRecord(policy: UploadPolicy): Record<string, number> {
    const fields = UPLOAD_LIMIT_FIELDS[policy.mediaKind] || [];
    const limits: Record<string, number> = {};
    for (const spec of fields) {
      const value = (policy as any)[spec.field];
      if (Number.isFinite(value) && value > 0) limits[spec.field] = value;
    }
    return limits;
  }

  /**
   * The policy a controller must satisfy before asking for an upload URL.
   *
   * @param type the durable upload type the controller is about to write onto
   *   the file record — a literal in our own code, never a value from a request
   * @param declaredSize the size the client claims, when it sent one
   */
  public assertPublicUpload(type: string, declaredSize?: number): UploadPolicy {
    // The *effective* policy, so a limit an operator raised this morning is the
    // limit this request is judged by.
    const policy = this.effectivePolicy(type);

    if (!policy) {
      // Logged as an error rather than a warning: every caller passes a literal,
      // so reaching this means a controller names a type the registry does not
      // have, which is a deployment bug and not user input.
      this.logger.error(`No upload policy is registered for type "${type}"`);
      throw new UnsupportedUploadTypeException();
    }

    if (!policy.publicUpload) {
      this.logger.warn(`Refused a public upload URL for internal-only type "${type}"`);
      throw new UnsupportedUploadTypeException();
    }

    // Only a positive, finite claim is worth acting on. A missing or nonsensical
    // one is not treated as zero — it simply means this courtesy cannot run, and
    // the file server settles it from the bytes.
    if (Number.isFinite(declaredSize) && (declaredSize as number) > policy.maxBytes) {
      // The byte-count code, answered with 413 — not the format code and not the
      // resolution one. The file may be perfectly valid at a perfectly ordinary
      // resolution and simply saved too large, and the only advice that helps is
      // "save it smaller".
      throw new UploadFileTooLargeException(policy);
    }

    return policy;
  }

  /** The effective policy for a type, or `null`. For callers reporting limits. */
  public policyFor(type: string): UploadPolicy | null {
    return this.effectivePolicy(type);
  }

  /** The unadjusted default, ignoring settings. For tests and for diagnostics. */
  public defaultPolicyFor(type: string): UploadPolicy | null {
    return getUploadPolicy(type);
  }
}
