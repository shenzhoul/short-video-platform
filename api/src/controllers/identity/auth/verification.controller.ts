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
import { ResendVerificationPayload, VerifyEmailPayload } from 'src/payloads/identity';
import { EmailVerificationService, VerifyEmailResult } from 'src/services/identity/auth/email-verification.service';

/**
 * Confirming an email address.
 *
 * ## Why the token arrives by POST when the link in the email is a GET
 *
 * The mailed link points at a **page** on the user web app
 * (`/auth/verify-email?token=…`), and that page posts the token here. Three
 * reasons, in order of how much they matter:
 *
 * 1. **Mail clients follow links.** Gmail, Outlook and most security appliances
 *    fetch the URLs in a message to scan them. A GET that consumes a token is
 *    consumed by the scanner before the recipient ever clicks, and the person
 *    who actually opens the mail finds a link that has already been used.
 * 2. **A token in a URL leaks.** It lands in the server access log, in any
 *    `Referer` the page emits, and in browser history. A request body does not.
 * 3. The page can render real states — confirmed, already confirmed, expired —
 *    instead of a status word in a query string, and the API stays a JSON API
 *    rather than a redirect machine.
 */
@Controller('auth')
@ApiTags('Authentication')
export class VerificationController {
  constructor(
    private readonly emailVerificationService: EmailVerificationService
  ) { }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CustomThrottlerGuard)
  // Generous, because a page may legitimately retry, and pointless to tighten:
  // guessing a 256-bit token is not a rate-limit problem. This bounds nuisance
  // traffic, nothing more.
  @Throttle({ default: { limit: 20, ttl: 3600000 } })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Confirm an email address',
    description: 'Consumes a single-use token from a confirmation email. Idempotent for an account that is already confirmed.'
  })
  @ApiBody({ type: VerifyEmailPayload })
  @ApiResponse({ status: 200, description: 'Address confirmed' })
  @ApiResponse({ status: 400, description: 'The link is unknown, expired, superseded or already used (error: VERIFICATION_TOKEN_INVALID)' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  public async verifyEmail(
    @Body() payload: VerifyEmailPayload
  ): Promise<DataResponse<VerifyEmailResult>> {
    const result = await this.emailVerificationService.verify(payload.token);
    return DataResponse.ok(result);
  }

  @Post('verification/resend')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CustomThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 3600000 } })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Send the confirmation email again',
    description:
      'Accepts an email address or a username. Always answers 200 with the same body, whether or not an account exists, '
      + 'is already confirmed, or is within its cooldown — the response must not reveal which addresses are registered. '
      + 'Rate limited per IP and per identifier.'
  })
  @ApiBody({ type: ResendVerificationPayload })
  @ApiResponse({ status: 200, description: 'Request accepted. Says nothing about whether mail was sent.' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  public async resendVerification(
    @Body() payload: ResendVerificationPayload
  ): Promise<DataResponse<{ accepted: true }>> {
    // The return value is deliberately discarded. Branching on it here — even to
    // change a message — would turn this endpoint into an oracle for "is this
    // address registered, and is it already confirmed".
    await this.emailVerificationService.resend(payload.identifier);

    // `accepted`, not `sent`. This same body is returned when the account does
    // not exist, when it is already confirmed, when the per-address cooldown
    // declined, and when Redis could not report the rate-limit state and mail
    // was therefore suppressed. In most of those cases nothing was sent, so
    // `sent: true` was a false success — a field that asserts something the
    // server has not done and cannot know.
    return DataResponse.ok({ accepted: true });
  }
}
