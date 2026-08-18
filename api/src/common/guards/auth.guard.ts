import {
  CanActivate, ExecutionContext,
  Injectable
} from '@nestjs/common';
import { USER_STATUS } from 'src/common/constants';
import { STATUS } from 'src/kernel/constants';
import { AuthService } from 'src/services/identity/auth/auth.service';
import { TokenService } from 'src/services/identity/auth/token.service';

/**
 * Authentication guard that verifies JWT tokens and ensures user is authenticated
 * Validates token, checks user status, and attaches user data to request object
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService
  ) { }

  /**
   * Validates authentication token and user status for protected routes
   * @param context - Execution context containing request information
   * @returns Promise<boolean> - True if user is authenticated and active, false otherwise
   * SECURITY: Only accepts Bearer tokens from Authorization header (query parameters removed for security)
   * SECURITY: Checks token blacklist for logout functionality
   * TODO: Add rate limiting to prevent brute force attacks
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    // SECURITY FIX: Only accept tokens from Authorization header (Bearer prefix optional)
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return false;
    }

    // Extract token - Bearer prefix is optional
    let token = authHeader;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7); // Remove 'Bearer ' prefix
    }

    if (!token) return false;

    // Validate Redis-based token
    const tokenData = await this.tokenService.validateToken(token);
    if (!tokenData) {
      return false;
    }

    let user;
    try {
      user = request.user || await this.authService.getUserFromTokenData(tokenData);
      if (!user || user.status === STATUS.INACTIVE || user.status === USER_STATUS.DELETED) {
        return false;
      }
    } catch {
      return false;
    }

    if (!request.user) request.user = user;
    return true;
  }
}
