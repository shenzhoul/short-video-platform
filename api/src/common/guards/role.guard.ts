import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { USER_STATUS } from 'src/common/constants/identity';
import { STATUS } from 'src/kernel/constants';
import { AuthService } from 'src/services/identity/auth/auth.service';

/**
 * Role-based authorization guard that checks user roles against required roles
 * Works with @Roles decorator to enforce role-based access control
 */
@Injectable()
export class RoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService
  ) { }

  /**
   * Validates user authentication and checks if user has required roles
   * @param context - Execution context containing request and metadata
   * @returns Promise<boolean> - True if user has required roles, false otherwise
   * TODO: Refactor role checking logic to be more maintainable and extensible
   * TODO: Add support for hierarchical roles (admin > creator > user)
   * TODO: Consider caching user role information to improve performance
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.get<string[]>('roles', context.getHandler());
    if (!roles) {
      return true;
    }

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
    const user = request.user || await this.authService.getUserFromToken(token);
    if (!user || user.status !== STATUS.ACTIVE && user.status !== USER_STATUS.UNDER_REVIEW) {
      return false;
    }

    if (!request.user) request.user = user;

    if (user.isAdmin && roles.includes('admin')) {
      return true;
    }

    if (roles.includes('user')) {
      return true;
    }

    return false;
  }
}
