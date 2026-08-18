/**
 * HTML Sanitization Decorator
 *
 * ✅ SECURITY: Automatic HTML sanitization for DTO properties
 *
 * This decorator provides automatic HTML sanitization for class properties,
 * particularly useful for DTO validation. It integrates with class-transformer
 * to sanitize HTML content during object transformation.
 *
 * Key Security Features:
 * - Automatic XSS prevention during DTO transformation
 * - Configurable sanitization profiles
 * - Integration with class-validator
 * - Type-safe implementation
 *
 * @author ShenZhoul
 * @version 1.0.0
 */

import { Transform } from 'class-transformer';
import { SANITIZATION_PROFILES, sanitizeHtml } from '../utils/html-sanitizer.util';

/**
 * Decorator options for HTML sanitization
 */
export interface SanitizeHtmlOptions {
  /**
   * Sanitization profile to use
   * - STRICT: Basic formatting only (comments, messages)
   * - BASIC: Simple formatting (post posts, descriptions)
   * - RICH: Advanced formatting (admin content)
   * - PLAIN_TEXT: Strip all HTML
   */
  profile?: keyof typeof SANITIZATION_PROFILES;

  /**
   * Whether to allow empty/null values
   * @default true
   */
  allowEmpty?: boolean;

  /**
   * Maximum length after sanitization
   * @default undefined (no limit)
   */
  maxLength?: number;
}

/**
 * Decorator to automatically sanitize HTML content in DTO properties
 *
 * ✅ SECURITY: Automatic XSS prevention for user input
 *
 * This decorator uses class-transformer to automatically sanitize HTML content
 * when transforming plain objects to class instances. It prevents XSS attacks
 * by cleaning user-generated content before it reaches business logic.
 *
 * @param options - Sanitization configuration options
 * @returns Property decorator function
 *
 * @example
 * ```typescript
 * export class CreatePostDto {
 *   @SanitizeHtml({ profile: 'BASIC' })
 *   @IsString()
 *   @IsNotEmpty()
 *   content: string;
 *
 *   @SanitizeHtml({ profile: 'STRICT', maxLength: 500 })
 *   @IsString()
 *   @IsOptional()
 *   description?: string;
 *
 *   @SanitizeHtml({ profile: 'PLAIN_TEXT' })
 *   @IsString()
 *   title: string;
 * }
 * ```
 *
 * @security CRITICAL - Prevents XSS attacks in DTO transformation
 */
export function SanitizeHtml(options: SanitizeHtmlOptions = {}) {
  const {
    profile = 'STRICT',
    allowEmpty = true,
    maxLength
  } = options;

  return Transform(({ value }) => {
    // Handle null/undefined values
    if (value === null || value === undefined) {
      return allowEmpty ? value : '';
    }

    // Only process string values
    if (typeof value !== 'string') {
      return allowEmpty ? '' : value;
    }

    // Handle empty strings
    if (value.trim() === '') {
      return allowEmpty ? value : '';
    }

    try {
      // Sanitize the HTML content
      let sanitized = sanitizeHtml(value, profile);

      // Apply length limit if specified
      if (maxLength && sanitized.length > maxLength) {
        sanitized = sanitized.substring(0, maxLength).trim();
      }

      return sanitized;
    } catch {
      // Return empty string on error for security
      return '';
    }
  });
}

/**
 * Decorator to strip all HTML and return plain text
 *
 * ✅ SECURITY: Complete HTML removal for plain text fields
 *
 * This decorator removes all HTML tags and returns clean plain text.
 * Useful for titles, names, and other fields that should not contain HTML.
 *
 * @param maxLength - Optional maximum length after sanitization
 * @returns Property decorator function
 *
 * @example
 * ```typescript
 * export class CreateUserDto {
 *   @SanitizeHtmlPlainText(100)
 *   @IsString()
 *   @IsNotEmpty()
 *   displayName: string;
 * }
 * ```
 *
 * @security Safe plain text extraction from user input
 */
export function SanitizeHtmlPlainText(maxLength?: number) {
  return SanitizeHtml({
    profile: 'PLAIN_TEXT',
    maxLength,
    allowEmpty: false
  });
}

/**
 * Decorator for basic HTML sanitization (posts, descriptions)
 *
 * ✅ SECURITY: Basic XSS prevention for user posts and descriptions
 *
 * This decorator allows basic HTML formatting like paragraphs, lists,
 * and text formatting while preventing dangerous elements.
 *
 * @param maxLength - Optional maximum length after sanitization
 * @returns Property decorator function
 *
 * @example
 * ```typescript
 * export class CreatePostDto {
 *   @SanitizeHtmlBasic(5000)
 *   @IsString()
 *   @IsNotEmpty()
 *   text: string;
 * }
 * ```
 *
 * @security CRITICAL - Basic XSS prevention for user posts
 */
export function SanitizeHtmlBasic(maxLength?: number) {
  return SanitizeHtml({
    profile: 'BASIC',
    maxLength,
    allowEmpty: false
  });
}

/**
 * Decorator for strict HTML sanitization (comments, messages)
 *
 * ✅ SECURITY: Strict XSS prevention for user comments and messages
 *
 * This is a convenience decorator that applies strict HTML sanitization,
 * allowing only basic formatting like bold, italic, and line breaks.
 *
 * @param maxLength - Optional maximum length after sanitization
 * @returns Property decorator function
 *
 * @example
 * ```typescript
 * export class CreateCommentDto {
 *   @SanitizeHtmlStrict(250)
 *   @IsString()
 *   @IsNotEmpty()
 *   content: string;
 * }
 * ```
 *
 * @security CRITICAL - Strict XSS prevention for user comments
 */
export function SanitizeHtmlStrict(maxLength?: number) {
  return SanitizeHtml({
    profile: 'STRICT',
    maxLength,
    allowEmpty: false
  });
}