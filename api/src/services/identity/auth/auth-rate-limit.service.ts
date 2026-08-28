import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import * as crypto from 'crypto';
import Redis from 'ioredis';
import { REDIS_KEYS } from 'src/kernel/infras/redis/redis-keys';

/**
 * What the limiter was able to determine.
 *
 * Three states, not two, because "we could not find out" is genuinely different
 * from "no" and the two callers want opposite things from it. Collapsing them
 * into a boolean is what forced the old fail-open behaviour on every caller
 * alike.
 */
export type RateLimitDecision =
  /** Within every limit. Proceed. */
  | 'allowed'
  /** A cooldown or window ceiling was hit. Do not proceed. */
  | 'limited'
  /** Redis could not answer. The caller decides what that means. */
  | 'unavailable';

export interface IdentifierLimit {
  /** Distinguishes the counters, e.g. `verification-resend`. */
  action: string;
  /** Email or username, already normalised by the caller. */
  identifier: string;
  /** Minimum gap between two accepted requests. */
  cooldownSeconds: number;
  /** Ceiling within `windowSeconds`. */
  maxPerWindow: number;
  windowSeconds: number;
}

/**
 * Per-identifier cooldowns for the endpoints that send email.
 *
 * ## Why this exists alongside the throttler
 *
 * `CustomThrottlerGuard` limits by IP, which is the right first layer and the
 * wrong only layer: one address behind a shared NAT is limited by other
 * people's traffic, and one attacker with a pool of addresses is not limited at
 * all. This adds a second axis keyed on *who the mail would go to*, which is the
 * thing actually being protected.
 *
 * ## Why the identifier is hashed
 *
 * A Redis key is readable by anyone with Redis access and shows up in `MONITOR`,
 * in slow-log entries and in any key-space dump. The stored key says how often
 * somebody asked without saying who they are.
 *
 * ## Why every key has a TTL
 *
 * Repo rule: no TTL-less caches. Both keys expire on their own, so an abandoned
 * counter cannot lock a user out permanently and the keyspace cannot grow
 * without bound.
 *
 * ## Refusals are silent
 *
 * Callers must **not** turn a refusal into an error response: a rate limit that
 * is observable per address is an enumeration oracle — "this one is limited, so
 * it exists". The endpoint returns its usual generic acknowledgement and simply
 * does not send.
 *
 * ## It does not decide what `unavailable` means
 *
 * That is deliberately the caller's call, because the right answer differs. See
 * `consumeForMailDispatch`.
 */
@Injectable()
export class AuthRateLimitService {
  private readonly logger = new Logger(AuthRateLimitService.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  /**
   * Ask whether a slot is available, reporting honestly when Redis cannot say.
   *
   * Two independent gates, both required:
   * - a **cooldown** key that simply exists for N seconds after an accepted
   *   request, set with `NX` so the check and the claim are one atomic command;
   * - a **window counter** incremented with an expiry set on first use.
   */
  public async consume(limit: IdentifierLimit): Promise<RateLimitDecision> {
    const hash = AuthRateLimitService.hashIdentifier(limit.identifier);
    const cooldownKey = REDIS_KEYS.authRateLimit(`${limit.action}:cooldown:${hash}`);
    const windowKey = REDIS_KEYS.authRateLimit(`${limit.action}:window:${hash}`);

    try {
      const claimed = await this.redis.set(cooldownKey, '1', 'EX', limit.cooldownSeconds, 'NX');
      if (!claimed) return 'limited';

      const used = await this.redis.incr(windowKey);
      if (used === 1) {
        await this.redis.expire(windowKey, limit.windowSeconds);
      } else if (used === 2) {
        // Defensive: an INCR against a key with no TTL (a crash between INCR and
        // EXPIRE on the first call) would otherwise count for ever.
        const ttl = await this.redis.ttl(windowKey);
        if (ttl < 0) await this.redis.expire(windowKey, limit.windowSeconds);
      }

      if (used > limit.maxPerWindow) {
        // The window is spent. The cooldown key stays — there is no reason to
        // let a refused caller retry sooner than an accepted one.
        return 'limited';
      }

      return 'allowed';
    } catch (error: any) {
      this.logUnavailable(limit.action, hash, error);
      return 'unavailable';
    }
  }

  /**
   * The decision for an endpoint whose side effect is **sending mail**.
   *
   * Fails **closed**: if Redis cannot tell us the rate-limit state, no mail goes
   * out.
   *
   * The earlier version failed open, on the reasoning that a limiter protecting
   * a quota should not break account creation. That reasoning does not survive
   * contact with what this particular limiter guards. It is the *only* thing
   * bounding how many messages a single Gmail account sends, and Gmail's free
   * tier throttles, then locks, an account whose traffic looks abusive. So
   * "Redis is down" would become "the send limit is off", which is precisely
   * when an attacker would want it off, and the failure is not self-correcting:
   * a locked sender account stays locked long after Redis recovers.
   *
   * Failing closed costs a delayed confirmation email. Failing open costs the
   * mailbox the whole feature depends on.
   *
   * Crucially this changes **nothing a caller can observe**. The endpoints
   * answer the same generic acknowledgement whatever this returns, so no client
   * — and no attacker — can tell a rate-limited address from an unregistered one
   * from a Redis outage.
   */
  public async consumeForMailDispatch(limit: IdentifierLimit): Promise<boolean> {
    return (await this.consume(limit)) === 'allowed';
  }

  /** Seconds until the cooldown for an identifier lapses; 0 when it is clear. */
  public async cooldownRemaining(action: string, identifier: string): Promise<number> {
    try {
      const hash = AuthRateLimitService.hashIdentifier(identifier);
      const ttl = await this.redis.ttl(REDIS_KEYS.authRateLimit(`${action}:cooldown:${hash}`));
      return ttl > 0 ? ttl : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Report an outage without describing who was asking or how to reach Redis.
   *
   * Structured and deliberately narrow: the action, a truncated hash prefix
   * (enough to correlate repeated failures for one identifier, not enough to
   * reverse), and the error's *name and code* only. Not `error.message` — an
   * ioredis connection error can carry the host, port and, on some auth
   * failures, the credential it tried.
   */
  private logUnavailable(action: string, hash: string, error: any): void {
    this.logger.warn(JSON.stringify({
      event: 'auth_rate_limit_unavailable',
      action,
      identifierHashPrefix: hash.slice(0, 12),
      errorName: error?.name || 'Error',
      errorCode: error?.code || null,
      outcome: 'mail_dispatch_suppressed'
    }));
  }

  private static hashIdentifier(identifier: string): string {
    return crypto.createHash('sha256').update(identifier.trim().toLowerCase()).digest('hex');
  }
}
