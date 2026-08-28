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
import { DataResponse } from 'src/kernel';
import { ForgotPasswordPayload, ResetPasswordPayload } from 'src/payloads/identity';
import { PasswordRecoveryService } from 'src/services/identity/auth/password-recovery.service';

/**
 * Forgotten-password requests and the reset that follows.
 *
 * Public and unauthenticated, which is what makes the response discipline
 * load-bearing: `POST /auth/forgot-password` answers with the same body for a
 * registered address, an unregistered one, an unconfirmed one and a
 * rate-limited one. Any difference — a different message, a different status,
 * an error — turns this into a way to enumerate who has an account here.
 *
 * `POST /auth/reset-password` is the only route in the API that lets somebody
 * change their own password. `PUT /admin/auth/user/password` remains admin-only
 * and is unchanged.
 */
@Controller('auth')
@ApiTags('Authentication')
export class PasswordRecoveryController {
  constructor(
    private readonly passwordRecoveryService: PasswordRecoveryService
  ) { }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CustomThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 3600000 } })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Request a password reset email',
    description:
      'Always answers 200 with the same body. Whether an account exists, whether its address is confirmed, and whether '
      + 'the per-address cooldown allowed a send are all withheld deliberately. Rate limited per IP and per address.'
  })
  @ApiBody({ type: ForgotPasswordPayload })
  @ApiResponse({ status: 200, description: 'Request accepted. Says nothing about whether mail was sent.' })
  @ApiResponse({ status: 400, description: 'The value supplied is not a valid email address' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  public async forgotPassword(
    @Body() payload: ForgotPasswordPayload
  ): Promise<DataResponse<{ accepted: true }>> {
    // Return value discarded on purpose — see the class comment.
    await this.passwordRecoveryService.requestReset(payload.email);

    // `accepted`, not `sent`. The same body comes back for an unregistered
    // address, a deleted account, a cooldown, and a Redis outage that suppressed
    // the send. Claiming `sent: true` in any of those is a false success.
    return DataResponse.ok({ accepted: true });
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CustomThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 3600000 } })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Set a new password from a reset link',
    description:
      'Consumes a single-use token. Invalidates every existing session for the account. Does not sign the user in, and '
      + 'does not change status, role, profile or email-confirmation state. The password must be the SHA-256 digest the '
      + 'web client produces, exactly as login and registration send it.'
  })
  @ApiBody({ type: ResetPasswordPayload })
  @ApiResponse({ status: 200, description: 'Password updated' })
  @ApiResponse({ status: 400, description: 'The link is unknown, expired or already used (error: RESET_TOKEN_INVALID), or the password failed validation' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  public async resetPassword(
    @Body() payload: ResetPasswordPayload
  ): Promise<DataResponse<{ reset: true }>> {
    const result = await this.passwordRecoveryService.resetPassword(payload.token, payload.password);
    return DataResponse.ok(result);
  }
}
