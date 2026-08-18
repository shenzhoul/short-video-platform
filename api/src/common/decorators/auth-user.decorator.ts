import { createParamDecorator } from '@nestjs/common';

/**
 * Parameter decorator to extract the current authenticated user from the request
 * Works with both HTTP requests and WebSocket connections
 *
 * Usage:
 * ```typescript
 * @Get('/profile')
 * getProfile(@CurrentUser() authUser: AuthUserDto) {
 *   return user;
 * }
 * ```
 *
 * @param data - Optional data parameter (unused)
 * @param req - Request context containing user information
 * @returns The authenticated user object or undefined if not authenticated
 */
export const CurrentUser = createParamDecorator((data, req) => {
  return req.user || req.args[0].user;
});
