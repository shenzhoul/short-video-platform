import { Transform } from 'class-transformer';
import {
  IsNotEmpty, IsString, MaxLength
} from 'class-validator';

/**
 * A token presented from a mailed link.
 *
 * `MaxLength` bounds what reaches the hash function. The tokens this system
 * issues are 43 characters of `base64url`; 512 is generous room for a future
 * format while refusing a caller who posts a megabyte of text at an
 * unauthenticated route.
 */
export class VerifyEmailPayload {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  token: string;
}

/**
 * "Send me the confirmation link again."
 *
 * The field is called `identifier` rather than `username` because it accepts
 * either an email address or a username: a visitor who signed in with their
 * username has no address to hand, and a name that says `username` while
 * accepting an email is a name that will mislead the next person to read it.
 *
 * No password. That is what makes this reachable from the signup screen — where
 * there is no session — and it is also why the response is unconditionally
 * generic and the endpoint is rate limited on both IP and identifier.
 */
export class ResendVerificationPayload {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  identifier: string;
}
