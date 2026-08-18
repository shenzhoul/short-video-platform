import {
  Body,
  Controller,
  Put,
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
import { CurrentUser } from 'src/common/decorators/auth-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RoleGuard } from 'src/common/guards';
import { AuthUserDto } from 'src/dtos/identity/auth-user.dto';
import { DataResponse } from 'src/kernel';
import {
  PasswordAdminChangePayload
} from 'src/payloads/identity';
import { AuthService } from 'src/services/identity/auth/auth.service';
import { TokenService } from 'src/services/identity/auth/token.service';

@Controller('admin/auth')
@ApiTags('Admin Authentication')
@ApiSecurity('token-auth')
export class AdminAuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService
  ) { }

  @Put('user/password')
  @Roles('admin')
  @UseGuards(RoleGuard)
  @UsePipes(new ValidationPipe({
    transform: true,
    whitelist: true
  }))
  @ApiOperation({
    summary: 'Admin update user password',
    description: 'Admin endpoint to update any user\'s password. When changing own password, preserves current session. When changing another user\'s password, invalidates all their sessions. Requires admin role.'
  })
  @ApiBody({
    type: PasswordAdminChangePayload,
    description: 'Password change data',
    examples: {
      'change-own-password': {
        summary: 'Admin changing their own password',
        value: {
          password: 'newadminpassword123'
        }
      },
      'change-user-password': {
        summary: 'Admin changing another user\'s password',
        value: {
          userId: 'user-id-here',
          password: 'newuserpassword123'
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Password updated successfully',
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
              example: 'User password updated successfully. All user sessions have been logged out for security.'
            },
            sessionsInvalidated: {
              type: 'number',
              description: 'Number of sessions that were invalidated',
              example: 3
            }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid authentication'
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin role required'
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Invalid password format'
  })
  public async updateUserPassword(
    @Req() req: Request,
    @CurrentUser() user: AuthUserDto,
    @Body() payload: PasswordAdminChangePayload
  ): Promise<DataResponse<{ success: boolean; message: string; sessionsInvalidated: number }>> {
    const targetUserId = payload.userId || user._id;
    // Update the password first
    await this.authService.updateAuthPassword({
      userId: targetUserId,
      value: payload.password,
      type: 'password'
    });

    const isOwnPassword = `${targetUserId}` === `${user._id}`;
    let sessionsInvalidated = 0;
    if (isOwnPassword) {
      // If admin is changing their own password, preserve current session
      const authHeader = req.headers.authorization;
      let currentToken = null;
      if (authHeader) {
        // Extract token - Bearer prefix is optional
        currentToken = authHeader.startsWith('Bearer ')
          ? authHeader.substring(7)
          : authHeader;
      }

      if (currentToken) {
        // Remove all user tokens except the current one
        sessionsInvalidated = await this.tokenService.removeAllUserTokensExcept(
          targetUserId,
          currentToken
        );
      } else {
        // If no current token, remove all user tokens
        sessionsInvalidated = await this.tokenService.removeAllUserTokens(
          targetUserId
        );
      }
    } else {
      // Admin changing another user's password - logout ALL target user sessions
      sessionsInvalidated = await this.tokenService.removeAllUserTokens(
        targetUserId
      );
    }

    const message = isOwnPassword
      ? 'Admin password updated successfully. Other sessions have been logged out for security.'
      : 'User password updated successfully. All user sessions have been logged out for security.';

    return DataResponse.ok({
      success: true,
      message,
      sessionsInvalidated
    });
  }
}
