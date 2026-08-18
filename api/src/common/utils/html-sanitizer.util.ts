/**
 * HTML Sanitization Utility
 *
 * ✅ SECURITY: Prevents XSS attacks through comprehensive HTML sanitization
 *
 * This utility provides secure HTML sanitization for user-generated content to prevent
 * Cross-Site Scripting (XSS) attacks. It uses DOMPurify for robust HTML cleaning
 * with configurable security profiles for different content types.
 *
 * Key Security Features:
 * - XSS attack prevention through HTML sanitization
 * - Multiple security profiles for different content types
 * - Script tag removal and dangerous attribute filtering
 * - URL validation for links and media
 * - Configurable whitelist-based approach
 *
 * @author ShenZhoul
 * @version 1.0.0
 */

import * as DOMPurify from 'isomorphic-dompurify';

/**
 * Security profiles for different types of user content
 * Each profile defines allowed tags and attributes for specific use cases
 */
export const SANITIZATION_PROFILES = {
  /**
   * STRICT: For comments, messages, and basic text content
   * Only allows basic formatting without any potentially dangerous elements
   */
  STRICT: {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u'],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true,
    ALLOW_DATA_ATTR: false
  },

  /**
   * BASIC: For post posts and user descriptions
   * Allows basic formatting and simple lists
   */
  BASIC: {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'blockquote'],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true,
    ALLOW_DATA_ATTR: false
  },

  /**
   * RICH: For admin content and email templates
   * Allows more formatting options including embedded media
   */
  RICH: {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
      'div', 'span', 'figure', 'figcaption', 'sub', 'sup', 'code', 'pre', 'hr',
      'iframe', 'video', 'source', 'embed', 'object', 'param'
    ],
    ALLOWED_ATTR: [
      'href', 'src', 'alt', 'title', 'target', 'style', 'class',
      'width', 'height', 'align', 'data-align', 'data-size', 'data-proportion',
      'data-rotate', 'data-file-name', 'data-file-size', 'data-origin',
      'frameborder', 'allowfullscreen', 'allow', 'loading', 'controls', 'autoplay',
      'loop', 'muted', 'poster', 'preload', 'type', 'name', 'value', 'data-*'
    ],
    KEEP_CONTENT: true,
    ALLOW_DATA_ATTR: true
  },

  /**
   * PLAIN_TEXT: Strips all HTML tags
   * For content that should be plain text only
   */
  PLAIN_TEXT: {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true,
    ALLOW_DATA_ATTR: false
  }
};

/**
 * Sanitize HTML content to prevent XSS attacks
 *
 * ✅ SECURITY: Comprehensive XSS prevention for user-generated content
 *
 * This function provides robust HTML sanitization using DOMPurify with
 * configurable security profiles. It removes dangerous scripts, attributes,
 * and elements while preserving safe formatting.
 *
 * @param content - Raw HTML content from user input
 * @param profile - Security profile to use (STRICT, BASIC, RICH, PLAIN_TEXT)
 * @returns Sanitized HTML content safe for display
 *
 * @example
 * ```typescript
 * // Sanitize user comment (strict)
 * const safeComment = sanitizeHtml(userComment, 'STRICT');
 *
 * // Sanitize post post (basic formatting allowed)
 * const safePostPost = sanitizeHtml(postContent, 'BASIC');
 *
 * // Sanitize admin content (rich formatting allowed)
 * const safeAdminContent = sanitizeHtml(adminContent, 'RICH');
 *
 * // Strip all HTML (plain text only)
 * const plainText = sanitizeHtml(content, 'PLAIN_TEXT');
 * ```
 *
 * @security CRITICAL - Prevents XSS attacks in user-generated content
 */
export function sanitizeHtml(
  content: string | null | undefined,
  profile: keyof typeof SANITIZATION_PROFILES = 'STRICT'
): string {
  // Handle null/undefined input
  if (!content || typeof content !== 'string') {
    return '';
  }

  // Get sanitization configuration for the specified profile
  const config = SANITIZATION_PROFILES[profile];

  if (!config) {
    throw new Error(`Invalid sanitization profile: ${profile}`);
  }

  try {
    // Configure DOMPurify with the security profile
    const sanitizeConfig: any = {
      ALLOWED_TAGS: config.ALLOWED_TAGS,
      ALLOWED_ATTR: config.ALLOWED_ATTR,
      KEEP_CONTENT: config.KEEP_CONTENT,
      ALLOW_DATA_ATTR: config.ALLOW_DATA_ATTR,
      // Additional security settings
      FORBID_TAGS: profile === 'RICH' ? ['script', 'form', 'input', 'button'] : ['script', 'object', 'embed', 'form', 'input', 'button'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'onchange', 'onsubmit'],
      SANITIZE_DOM: true,
      SANITIZE_NAMED_PROPS: true,
      // Remove dangerous protocols
      // eslint-disable-next-line no-useless-escape
      ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
    };

    // For RICH profile, allow safe CSS properties and validate iframe sources
    if (profile === 'RICH') {
      sanitizeConfig.ADD_ATTR = ['style'];

      // Hook to sanitize CSS in style attributes and validate iframe/embed sources
      DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
        // Sanitize style attribute
        if (data.attrName === 'style') {
          // Allow only safe CSS properties for formatting and layout
          const safeProps = [
            'text-align', 'float', 'margin', 'margin-left', 'margin-right',
            'margin-top', 'margin-bottom', 'padding', 'padding-left',
            'padding-right', 'padding-top', 'padding-bottom', 'width', 'height',
            'max-width', 'max-height', 'display', 'font-size', 'font-weight',
            'font-family', 'color', 'background-color', 'border', 'border-radius'
          ];

          const styles = data.attrValue.split(';').filter(Boolean);
          const sanitizedStyles = styles
            .map(s => s.trim())
            .filter(s => {
              const prop = s.split(':')[0].trim().toLowerCase();
              return safeProps.includes(prop);
            })
            .join('; ');

          data.attrValue = sanitizedStyles;
        }

        // Validate iframe/embed sources - only allow trusted video platforms
        if (data.attrName === 'src' && (node.nodeName === 'IFRAME' || node.nodeName === 'EMBED')) {
          const trustedDomains = [
            'youtube.com', 'youtube-nocookie.com', 'youtu.be',
            'vimeo.com', 'player.vimeo.com',
            'dailymotion.com', 'dai.ly',
            'twitch.tv', 'player.twitch.tv',
            'facebook.com', 'fb.watch',
            'twitter.com', 'x.com',
            'soundcloud.com',
            'spotify.com',
            'tiktok.com'
          ];

          try {
            const url = new URL(data.attrValue);
            const isTrusted = trustedDomains.some(domain =>
              url.hostname === domain || url.hostname.endsWith(`.${domain}`)
            );

            if (!isTrusted) {
              // Remove untrusted iframe/embed
              data.attrValue = '';
            }
          } catch {
            // Invalid URL, remove it
            data.attrValue = '';
          }
        }
      });
    }

    const sanitized = DOMPurify.sanitize(content, sanitizeConfig);

    // Remove the hook after sanitization to prevent side effects
    if (profile === 'RICH') {
      DOMPurify.removeHook('uponSanitizeAttribute');
    }

    return String(sanitized).trim();
  } catch {
    // Return empty string on sanitization failure for security
    return '';
  }
}