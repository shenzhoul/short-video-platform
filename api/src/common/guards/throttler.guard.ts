import { Injectable } from '@nestjs/common';
import { ThrottlerGuard as NestThrottlerGuard } from '@nestjs/throttler';
import { getTrustedClientIp } from '../utils/client-ip';

/**
 * Custom Throttler Guard for Rate Limiting
 *
 * Extends the default NestJS ThrottlerGuard to provide enhanced IP detection
 * for accurate rate limiting behind proxies and load balancers.
 *
 * Features:
 * - Enhanced IP detection through multiple proxy headers
 * - Support for RealIpMiddleware integration
 * - Fallback to request-ip library for edge cases
 * - Handles X-Forwarded-For, X-Real-IP headers properly
 *
 * Usage:
 * @UseGuards(CustomThrottlerGuard)
 * @Throttle({ default: { limit: 5, ttl: 60000 } })
 */
@Injectable()
export class CustomThrottlerGuard extends NestThrottlerGuard {

  /**
   * Generate a unique tracker key for rate limiting based on IP address
   * @param context - Execution context containing request information
   * @returns string - Unique key for rate limiting
   */
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = req.user?._id || req.user?.id;
    if (userId) {
      return `user:${String(userId)}`;
    }

    return `ip:${getTrustedClientIp(req)}`;
  }
}
