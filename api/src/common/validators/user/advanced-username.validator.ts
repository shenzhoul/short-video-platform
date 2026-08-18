import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface
} from 'class-validator';
import { ALL_RESERVED_USERNAMES, USERNAME_CONFIG, USERNAME_UTILS } from 'src/common/constants';

/**
 * Advanced Username Validator with comprehensive validation rules
 *
 * Features:
 * - Reserved word checking
 * - Pattern validation
 * - Length constraints
 * - Character restrictions
 * - Profanity filtering
 * - Route conflict prevention
 */

// Re-export constants for backward compatibility
export { ALL_RESERVED_USERNAMES, USERNAME_CONFIG };

@ValidatorConstraint({ name: 'advancedUsername', async: false })
export class AdvancedUsername implements ValidatorConstraintInterface {
  validate(username: string): boolean {
    const result = USERNAME_UTILS.validate(username);
    return result.isValid;
  }

  public validateFormat(username: string): boolean {
    return USERNAME_CONFIG.ALLOWED_PATTERN.test(username);
  }

  public validateReservedWords(username: string): boolean {
    const lowercaseUsername = username.toLowerCase();
    return !ALL_RESERVED_USERNAMES.includes(lowercaseUsername);
  }

  public validatePatterns(username: string): boolean {
    return !USERNAME_CONFIG.FORBIDDEN_PATTERNS.some((pattern) => pattern.test(username));
  }

  defaultMessage(args?: ValidationArguments): string {
    const username = args?.value;
    const result = USERNAME_UTILS.validate(username);

    return result.reason || 'Username is invalid';
  }
}