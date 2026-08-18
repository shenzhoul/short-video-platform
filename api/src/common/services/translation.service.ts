import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Translation Service
 * Handles loading and providing translations in multiple languages from JSON files.
 * Supports dot notation for nested keys (e.g., 'errors.user_not_found')
 *
 * Usage:
 * - translationService.get('welcome_message', 'en') -> 'Welcome to the API'
 * - translationService.get('errors.invalid_credentials', 'es') -> 'Credenciales inválidas'
 * - translationService.getSupportedLanguages() -> ['en', 'es']
 *
 * Translation files are expected to be in src/i18n/ or dist/i18n/ (production)
 */
@Injectable()
export class TranslationService {
  private translations: Record<string, Record<string, string>> = {};
  private supportedLanguages: string[] = [];

  constructor() {
    this.loadTranslations();
  }

  /**
   * Get a translated string by key and language
   * Supports dot notation for nested keys (e.g., 'errors.user_not_found')
   * Supports parameter interpolation with {key} syntax (e.g., 'Hello {name}')
   * Falls back to 'en' if language is not supported
   * Returns the key itself if translation is not found
   *
   * @param key Translation key (supports dot notation)
   * @param lang Language code (e.g., 'en', 'es')
   * @param params Optional object with parameters for interpolation
   * @returns Translated string or the key if not found
   */
  get(key: string, lang: string, params?: Record<string, any>): string {
    const language = this.supportedLanguages.includes(lang) ? lang : 'en';
    let translation = this.getNestedValue(this.translations[language], key);

    if (!translation) {
      return key;
    }

    // Interpolate parameters if provided
    if (params) {
      translation = this.interpolate(translation, params);
    }

    return translation;
  }

  /**
   * Get all supported language codes
   * @returns Array of language codes (e.g., ['en', 'es'])
   */
  getSupportedLanguages(): string[] {
    return this.supportedLanguages;
  }

  /**
   * Interpolate parameters into a translation string
   * Supports {key} and {{key}} syntax for parameter replacement
   * @param template Translation string with placeholders
   * @param params Object with parameter values
   * @returns Interpolated string
   */
  private interpolate(template: string, params: Record<string, any>): string {
    return template.replace(/\{\{?\s*(\w+)\s*\}?\}/g, (match, key) => {
      return Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match;
    });
  }

  /**
   * Get a nested value from an object using dot notation
   * @param obj Object to search
   * @param path Dot-separated path (e.g., 'errors.user_not_found')
   * @returns The value at the path or undefined
   */
  private getNestedValue(obj: any, path: string): string | undefined {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Load all translation files from the i18n directory
   * Supports both development (src/i18n) and production (dist/i18n) paths
   */
  private loadTranslations(): void {
    const i18nPath = this.resolveI18nPath();

    try {
      const files = fs.readdirSync(i18nPath);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      for (const file of jsonFiles) {
        const lang = file.replace('.json', '');
        const filePath = path.join(i18nPath, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        this.translations[lang] = JSON.parse(content);
        this.supportedLanguages.push(lang);
      }
    } catch (error) {
      // Handle translation loading errors silently in production
      if (process.env.NODE_ENV !== 'production') {
        console.error('[TranslationService] Failed to load translations:', error);
      }
    }
  }

  private resolveI18nPath(): string {
    const candidates = [
      path.join(process.cwd(), 'i18n'),
      path.join(process.cwd(), 'api', 'i18n'),
      path.join(__dirname, '..', '..', '..', 'i18n')
    ];

    const foundPath = candidates.find(candidate => fs.existsSync(candidate));
    return foundPath || candidates[0];
  }
}
