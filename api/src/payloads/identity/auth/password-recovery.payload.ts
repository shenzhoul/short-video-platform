import { Transform } from 'class-transformer';
import {
  IsEmail, IsNotEmpty, IsString, MaxLength
} from 'class-validator';
import { HashedPassword } from 'src/payloads/shared/validation-utils';

/**
 * "I have forgotten my password."
 *
 * Email only — never a username. Accepting a username here would let somebody
 * aim a reset email at an account whose address they do not know, which is the
 * one thing this flow must not allow.
 *
 * Normalised the same way `createNewUserAccount` normalises on write, so an
 * address typed with different capitalisation still finds the account.
 */
export class ForgotPasswordPayload {
  @IsString()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @IsNotEmpty()
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email: string;
}

/**
 * "Here is the link, and here is my new password."
 *
 * `password` is the SHA-256 hex digest the browser produces, exactly as login
 * and registration send it — the reset form calls the same `hashPassword()`
 * helper. Sending the plaintext instead would store a hash of the wrong input
 * and the new password would simply not work.
 */
export class ResetPasswordPayload {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  token: string;

  @HashedPassword(8)
  password: string;
}
