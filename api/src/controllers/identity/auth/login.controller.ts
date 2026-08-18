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
  ApiTags
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CustomThrottlerGuard } from 'src/common/guards/throttler.guard';
import { DataResponse } from 'src/kernel';
import { LoginPayload } from 'src/payloads/identity';
import { AuthService } from 'src/services/identity/auth/auth.service';

@Controller('auth')
@ApiTags('Authentication')
export class LoginController {
  constructor(
    private readonly authService: AuthService
  ) { }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CustomThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 login attempts per minute
  @UsePipes(new ValidationPipe({
    transform: true,
    whitelist: true
  }))
  @ApiOperation({
    summary: 'User login',
    description: 'Authenticate user with email/username and password. Returns JWT token and user profile. Rate limited to 5 attempts per minute.'
  })
  @ApiBody({
    type: LoginPayload,
    description: 'Login credentials',
    examples: {
      'email-login': {
        summary: 'Login with email',
        value: {
          username: 'user@example.com',
          password: 'password123'
        }
      },
      'username-login': {
        summary: 'Login with username',
        value: {
          username: 'johndoe',
          password: 'password123'
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            token: {
              type: 'string',
              description: 'Authentication token',
              example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
            },
            profile: {
              type: 'object',
              description: 'User profile information'
            }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Invalid credentials or missing fields'
  })
  @ApiResponse({
    status: 429,
    description: 'Too many requests - Rate limit exceeded (5 attempts per minute)'
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid credentials'
  })
  public async login(
    @Body() payload: LoginPayload,
    @Req() req: Request
  ): Promise<DataResponse<{ token: string, profile: any }>> {
    const data = await this.authService.login(payload, req);
    return DataResponse.ok(data);
  }
}
