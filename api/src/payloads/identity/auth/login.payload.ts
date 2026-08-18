import {
  IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength,
  MinLength
} from 'class-validator';

/**
 * Payload for user authentication
 * Used for login requests across all user types (users, creators, admins)
 */
export class LoginPayload {
  /**
   * Username or email address
   * Can be either username or email format
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255, { message: 'Username cannot exceed 255 characters' })
  username: string;

  /**
   * User password
   * Must meet minimum security requirements
   */
  @IsString()
  @MinLength(6, { message: 'Please recheck the password entered' })
  @MaxLength(100, { message: 'Password cannot exceed 100 characters' })
  @IsNotEmpty()
  password: string;

  /**
   * Remember login session
   * Extends session duration when enabled
   */
  @IsBoolean()
  @IsOptional()
  remember: boolean;
}
