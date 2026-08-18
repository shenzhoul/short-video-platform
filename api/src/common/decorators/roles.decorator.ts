import { SetMetadata } from '@nestjs/common';

/**
 * Method decorator to specify required roles for accessing an endpoint
 * Used in conjunction with RolesGuard to enforce role-based access control
 *
 * Usage:
 * ```typescript
 * @Roles('admin', 'user')
 * @Get('/admin-only')
 * adminOnlyEndpoint() {
 *   return 'Only admins and user can access this';
 * }
 * ```
 *
 * @param roles - Array of role names that are allowed to access the endpoint
 * @returns SetMetadata decorator with roles metadata
 */
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);
