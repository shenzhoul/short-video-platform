import { I18nContext } from 'nestjs-i18n';
import { TranslationService } from 'src/common/services/translation.service';

let translationService: TranslationService;

/**
 * Set the translation service instance for the __t function
 * Called once during app module initialization
 */
export function setTranslationService(service: TranslationService): void {
  translationService = service;
}

/**
 * Global translation function
 * Gets the current language from I18nContext and returns the translated string
 * Supports dot notation for nested keys (e.g., 'errors.invalid_credentials')
 * Supports parameter interpolation for dynamic content
 *
 * Usage:
 * - __t('welcome_message') -> 'Welcome to the API'
 * - __t('errors.invalid_credentials') -> 'Invalid credentials'
 * - __t('greeting', { name: 'John' }) -> 'Hello, John!'
 *
 * @param key Translation key (supports dot notation)
 * @param params Optional object with parameters for interpolation
 * @returns Translated string or the key if not found
 */
export function __t(key: string, params?: Record<string, any>): string {
  if (!translationService) {
    return key;
  }

  const i18n = I18nContext.current();
  const lang = i18n?.lang || 'en';

  return translationService.get(key, lang, params);
}
