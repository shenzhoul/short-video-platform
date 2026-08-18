import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { securityConfig } from "src/config";

/**
 * Authentication guard for internal API endpoints
 * Supports both API key and JWT token authentication
 */
@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // Check for API key in headers
    const apiKey = this.extractApiKey(request);
    if (apiKey) {
      return this.validateApiKey(apiKey);
    }

    // Check for JWT token
    const token = this.extractToken(request);
    if (token) {
      return this.validateJwtToken(token);
    }

    throw new UnauthorizedException('Authentication required. Provide API key or JWT token.');
  }

  /**
   * Extract API key from request headers
   * Supports both X-API-Key and Authorization: ApiKey formats
   */
  private extractApiKey(request: Request): string | undefined {
    // Check X-API-Key header
    const apiKeyHeader = request.headers['x-api-key'] as string;
    if (apiKeyHeader) {
      return apiKeyHeader;
    }

    // Check Authorization header with ApiKey scheme
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('ApiKey ')) {
      return authHeader.substring(7);
    }

    return undefined;
  }

  /**
   * Extract JWT token from Authorization header
   */
  private extractToken(request: Request): string | undefined {
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return undefined;
  }

  /**
   * Validate API key against configured secret
   */
  private validateApiKey(apiKey: string): boolean {
    const configuredApiKey = securityConfig?.apiSecretKey;

    if (!configuredApiKey) {
      throw new UnauthorizedException('API key authentication not configured');
    }

    if (apiKey !== configuredApiKey) {
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }

  /**
   * Validate JWT token
   */
  private validateJwtToken(token: string): boolean {
    try {
      const jwtSecret = securityConfig?.jwtSecret;

      if (!jwtSecret) {
        throw new UnauthorizedException('JWT authentication not configured');
      }

      // Verify and decode the token
      jwt.verify(token, jwtSecret);

      // You can add additional validation logic here
      // For example, check token expiration, user permissions, etc.

      return true;
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new UnauthorizedException('Invalid JWT token');
      }
      if (error instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedException('JWT token expired');
      }
      throw new UnauthorizedException('JWT token validation failed');
    }
  }
}
