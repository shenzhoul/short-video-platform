import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags
} from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from 'src/common/decorators';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { AuthUserDto } from 'src/dtos/identity/auth-user.dto';
import { DataResponse } from 'src/kernel';
import { TokenService } from 'src/services/identity/auth/token.service';
import { __t } from 'src/utils/translation';

/**
 * Logout Controller
 *
 * Handles secure logout functionality by blacklisting JWT tokens.
 * Provides endpoints for individual token logout and security-based mass logout.
 *
 * Features:
 * - Individual token blacklisting for normal logout
 * - Mass token blacklisting for security incidents
 * - Proper error handling and logging
 * - Support for different logout reasons
 *
 * Security:
 * - Requires valid authentication to logout
 * - Blacklists tokens immediately upon logout
 * - Supports emergency security actions
 */
@Controller('auth')
@ApiTags('Authentication')
@ApiSecurity('token-auth')
export class LogoutController {
  constructor(
    private readonly tokenService: TokenService
  ) {}

  /**
   * Standard logout endpoint
   * Blacklists the current JWT token to invalidate the session
   *
   * @param req - Express request object containing the JWT token
   * @param user - Current authenticated user
   * @returns Promise<DataResponse<{ success: boolean }>>
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @UsePipes(new ValidationPipe({
    transform: true,
    whitelist: true
  }))
  @ApiOperation({
    summary: 'User logout',
    description: 'Logout the current user session by blacklisting the JWT token. Requires valid authentication.'
  })
  @ApiResponse({
    status: 200,
    description: 'Logout successful',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Successfully logged out'
            }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing authentication token'
  })
  async logout(
    @Req() req: Request
  ): Promise<DataResponse<{ success: boolean; message: string }>> {
    try {
      // Extract token from Authorization header (Bearer prefix optional)
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return DataResponse.ok({
          success: false,
          message: __t('auth.no_valid_token')
        });
      }

      // Extract token - Bearer prefix is optional
      let token = authHeader;
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7); // Remove 'Bearer ' prefix
      }

      // Remove the token from Redis
      await this.tokenService.removeToken(token);

      return DataResponse.ok({
        success: true,
        message: __t('auth.successfully_logged_out')
      });
    } catch {
      return DataResponse.ok({
        success: false,
        message: __t('auth.logout_failed_maybe_invalidated')
      });
    }
  }

  /**
   * Security logout endpoint
   * Blacklists all tokens for the current user (emergency security action)
   *
   * @param req - Express request object containing the JWT token
   * @param user - Current authenticated user
   * @param body - Request body containing reason for security logout
   * @returns Promise<DataResponse<{ success: boolean }>>
   */
  @Post('logout/security')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @UsePipes(new ValidationPipe({
    transform: true,
    whitelist: true
  }))
  @ApiOperation({
    summary: 'Security logout - invalidate all sessions',
    description: 'Emergency security action that blacklists all JWT tokens for the current user. Use for security incidents or suspected compromise.'
  })
  @ApiBody({
    description: 'Security logout request',
    schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Reason for security logout',
          example: 'Suspicious activity detected'
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Security logout successful',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'All sessions have been invalidated for security reasons'
            },
            tokensBlacklisted: {
              type: 'number',
              description: 'Number of tokens that were blacklisted',
              example: 3
            }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing authentication token'
  })
  async securityLogout(
    @CurrentUser() user: AuthUserDto,
    @Body() _body: { reason?: string }
  ): Promise<DataResponse<{ success: boolean; message: string; tokensBlacklisted: number }>> {
    try {
      // Remove all user tokens from Redis
      const tokensBlacklisted = await this.tokenService.removeAllUserTokens(user._id);

      return DataResponse.ok({
        success: true,
        message: __t('auth.all_sessions_have_been_invalidated'),
        tokensBlacklisted
      });
    } catch {
      return DataResponse.ok({
        success: false,
        message: __t('auth.security_logout_failed_contact_support'),
        tokensBlacklisted: 0
      });
    }
  }

  /**
   * Public logout endpoint (for cases where token might be invalid)
   * Attempts to blacklist token without requiring authentication
   *
   * @param req - Express request object containing the JWT token
   * @returns Promise<DataResponse<{ success: boolean }>>
   */
  @Post('logout/public')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({
    transform: true,
    whitelist: true
  }))
  @ApiOperation({
    summary: 'Public logout',
    description: 'Public logout endpoint that attempts to invalidate a token without requiring authentication. Useful for cases where the token might be invalid or expired.'
  })
  @ApiResponse({
    status: 200,
    description: 'Logout processed successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Token invalidated successfully'
            }
          }
        }
      }
    }
  })
  async publicLogout(
    @Req() req: Request
  ): Promise<DataResponse<{ success: boolean; message: string }>> {
    try {
      // Extract token from Authorization header (Bearer prefix optional)
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return DataResponse.ok({
          success: true,
          message: __t('auth.no_token_to_invalidate')
        });
      }

      // Extract token - Bearer prefix is optional
      let token = authHeader;
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7); // Remove 'Bearer ' prefix
      }

      // Attempt to remove the token (even if it's invalid)
      await this.tokenService.removeToken(token);

      return DataResponse.ok({
        success: true,
        message: __t('auth.token_invalidated_successfully')
      });
    } catch {
      // Always return success for public logout to avoid information leakage
      return DataResponse.ok({
        success: true,
        message: __t('auth.logout_processed')
      });
    }
  }
}
