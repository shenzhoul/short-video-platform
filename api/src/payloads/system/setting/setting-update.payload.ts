import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Payload for updating system settings
 * Used by administrators to modify platform configuration
 */
export class SettingUpdatePayload {
  /**
   * Setting value (can be any type)
   * Type depends on the setting type (string, number, boolean, object)
   * For commission settings: must be 0-100
   */
  @IsOptional()
  value: any;

  /**
   * Human-readable setting name
   * Displayed in admin interface
   */
  @IsString()
  @IsOptional()
  @MaxLength(200, { message: 'Setting name cannot exceed 200 characters' })
  name: string;

  /**
   * Setting description with basic HTML support
   * Explains the setting's purpose and usage
   */
  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'Description cannot exceed 1000 characters' })
  description: string;
}
