import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { securityConfig } from 'src/config';

/**
 * Guard for the `/internal/files/*` surface, which is API-to-API only.
 *
 * This guard accepts **service credentials only**. It deliberately does NOT accept a bearer JWT.
 *
 * The guard it replaced verified any token signed with `JWT_SECRET` and checked no claims. That is
 * the same secret used to sign the short-lived upload tokens handed to browsers
 * (`generateUploadToken`, `generateTusToken`, signed-URL tokens), so any user who started a normal
 * upload held a credential that satisfied it — and the internal surface exposes `batch-delete`,
 * `update-ownership` and `remove-unused-files` over every user's media. Client tokens and service
 * credentials must never be verifiable by the same check.
 *
 * Two independent secrets are required, both shared with the API service:
 * - `API_SECRET_KEY`   (sent as `X-API-Key`, or `Authorization: ApiKey <key>`)
 * - `INTERNAL_API_KEY` (sent as `X-Internal-API-Key`) — enforced whenever it is configured here,
 *   which is what `main.ts` has always warned about but never actually checked.
 */
@Injectable()
export class InternalApiGuard implements CanActivate {
  private readonly logger = new Logger(InternalApiGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    this.assertApiKey(request);
    this.assertInternalApiKey(request);

    return true;
  }

  /**
   * `API_SECRET_KEY`, supplied as `X-API-Key` or `Authorization: ApiKey <key>`.
   */
  private assertApiKey(request: Request): void {
    const configuredApiKey = securityConfig?.apiSecretKey;

    if (!configuredApiKey) {
      this.logger.error('API_SECRET_KEY is not configured; refusing all internal requests.');
      throw new UnauthorizedException('Internal API authentication is not configured');
    }

    const presented = this.extractApiKey(request);

    if (!presented) {
      throw new UnauthorizedException('Internal API authentication required');
    }

    if (!secureEquals(presented, configuredApiKey)) {
      throw new UnauthorizedException('Invalid API key');
    }
  }

  /**
   * `INTERNAL_API_KEY`, supplied as `X-Internal-API-Key`.
   *
   * Enforced only when it is configured on this service, so an existing deployment that has not
   * distributed the value yet keeps working on the `API_SECRET_KEY` check alone. `main.ts` warns at
   * boot when it is missing.
   */
  private assertInternalApiKey(request: Request): void {
    const configuredInternalKey = process.env.INTERNAL_API_KEY;

    if (!configuredInternalKey) {
      return;
    }

    const presented = request.headers['x-internal-api-key'] as string | undefined;

    if (!presented || !secureEquals(presented, configuredInternalKey)) {
      throw new ForbiddenException('Invalid internal API key');
    }
  }

  private extractApiKey(request: Request): string | undefined {
    const apiKeyHeader = request.headers['x-api-key'] as string | undefined;
    if (apiKeyHeader) {
      return apiKeyHeader;
    }

    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('ApiKey ')) {
      return authHeader.slice('ApiKey '.length);
    }

    return undefined;
  }
}

/**
 * Constant-time string comparison.
 *
 * `timingSafeEqual` throws when the buffers differ in length, which would itself leak the configured
 * key's length, so the lengths are compared first and the result folded into a single boolean.
 */
function secureEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');

  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return timingSafeEqual(bufferA, bufferB);
}
