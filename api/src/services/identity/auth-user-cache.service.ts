import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis';
import { ObjectId } from 'mongodb';
import { AuthUserDto } from 'src/dtos/identity/auth-user.dto';

/**
 * Authentication User Cache Service
 *
 * Provides Redis-based caching for authenticated user data to optimize
 * authentication and authorization performance. This service caches only
 * the minimal user information required by auth guards (AuthGuard, RoleGuard).
 *
 * Cached Fields:
 * - _id: User identifier
 * - username: User's username
 * - status: Account status (active, inactive, suspended, etc.)
 * - isAdmin: Admin role flag
 * - isCreator: Creator role flag
 *
 * Performance Benefits:
 * - Eliminates DB lookups for every authenticated request
 * - Reduces latency for auth/role checks from ~5-10ms (DB) to ~1ms (Redis)
 * - Minimal memory footprint (~200 bytes per user)
 *
 * Memory Estimation (per user):
 * - Key: ~30 bytes ("auth_user:" + 24-char ObjectId)
 * - Value: ~150 bytes (JSON with _id, username, status, isAdmin, isCreator)
 * - Redis overhead: ~50 bytes per key
 * - Total: ~230 bytes per cached user
 *
 * For 10,000 users: ~2.3 MB RAM
 * For 100,000 users: ~23 MB RAM
 *
 * Note: Avatar is NOT cached here - it's not needed for auth/role checks.
 * Avatar should be included in full user profile responses from the API.
 *
 * Cache Invalidation:
 * - On user profile update (user.service.ts)
 * - On creator profile update (creator-profile.service.ts)
 * - On status change (admin actions)
 *
 * TTL: 24 hours (86400 seconds)
 *
 * @example
 * ```typescript
 * // Get cached user
 * const user = await authUserCacheService.get(userId);
 * if (user) {
 *   // Use cached data for auth checks
 *   if (user.status !== 'active') return false;
 * }
 *
 * // Set cache after DB lookup
 * await authUserCacheService.set(AuthUserDto.fromUser(dbUser));
 *
 * // Invalidate on update
 * await authUserCacheService.del(userId);
 * ```
 */
@Injectable()
export class AuthUserCacheService {
  constructor(
    @InjectRedis() private readonly redisClient: Redis
  ) { }

  public async get(userId: string | ObjectId): Promise<AuthUserDto> {
    const data = await this.redisClient.get(this.getKey(userId.toString()));
    if (!data) return null;
    return new AuthUserDto(JSON.parse(data));
  }

  public async set(user: any): Promise<void> {
    const data = AuthUserDto.fromUser(user);
    await this.redisClient.set(this.getKey(user._id.toString()), JSON.stringify(data.toResponse()), 'EX', 60 * 60 * 24); // 1 day
  }

  public async del(userId: string | ObjectId): Promise<void> {
    await this.redisClient.del(this.getKey(userId.toString()));
  }

  private getKey(userId: string | ObjectId): string {
    return `auth_user:${userId.toString()}`;
  }
}
