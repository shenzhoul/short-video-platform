import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
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
import { UserDto } from 'src/dtos/identity/user';
import { DataResponse } from 'src/kernel';
import { RegisterPayload } from 'src/payloads/identity';
import { UserAccountManagementService } from 'src/services/identity';

/**
 * Public self-registration.
 *
 * Separate from `AdminUserController.createUser` on purpose: that route stays
 * behind `@Roles('admin')` and `RoleGuard` and keeps accepting the fields an
 * administrator needs (status, verified-email). This one is open, so it
 * validates against `RegisterPayload` — no role, no status, no internal flags —
 * with `whitelist: true`, and the service assigns everything a visitor is not
 * allowed to choose.
 *
 * Both end up in `createNewUserAccount`, so there is one implementation of what
 * creating an account means.
 *
 * No session is issued here. The client signs in through the existing
 * `POST /auth/login` immediately afterwards, which keeps token issuance,
 * device-info capture and session expiry in exactly one place.
 */
@Controller('auth')
@ApiTags('Authentication')
export class RegisterController {
  constructor(
    private readonly userService: UserAccountManagementService
  ) { }

  @Post('register')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CustomThrottlerGuard)
  // Registration is cheaper to abuse than login and has no "wrong password"
  // feedback loop, so the window is tighter than the 5/minute login allows.
  @Throttle({ default: { limit: 5, ttl: 300000 } })
  @UsePipes(new ValidationPipe({
    transform: true,
    whitelist: true
  }))
  @ApiOperation({
    summary: 'Create an account',
    description: 'Public self-registration. Creates an ordinary, active user account. Rate limited to 5 attempts per 5 minutes.'
  })
  @ApiBody({
    type: RegisterPayload,
    description: 'New account details',
    examples: {
      register: {
        summary: 'Register a new account',
        value: {
          email: 'user@example.com',
          username: 'johndoe',
          name: 'John Doe',
          password: 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3'
        }
      }
    }
  })
  @ApiResponse({ status: 200, description: 'Account created' })
  @ApiResponse({ status: 400, description: 'Invalid data, or the email/username is already taken' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  public async register(
    @Body() payload: RegisterPayload
  ): Promise<DataResponse<Partial<UserDto>>> {
    const user = await this.userService.registerNewUser(payload);
    return DataResponse.ok(new UserDto(user).toResponse(true));
  }
}
