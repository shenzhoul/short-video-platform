import {
  Prop, Schema, SchemaFactory
} from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

@Schema({
  collection: 'settings',
  timestamps: true
})
export class Setting {
  /**
   * Unique key identifier for the setting (e.g., 'SITE_NAME')
   */
  @Prop({
    unique: true,
    required: true
  })
  key: string;

  /**
   * The actual value of the setting (can be string, number, boolean, object, etc.)
   */
  @Prop({
    type: MongooseSchema.Types.Mixed
  })
  value: any;

  /**
   * Human-readable display name for the setting
   */
  @Prop()
  name: string;

  /**
   * Description explaining what the setting controls
   */
  @Prop()
  description: string;

  /**
   * Setting group for organization (e.g., 'system', 'email', 'security')
   */
  @Prop({
    default: 'system'
  })
  group: string;

  /**
   * Whether this setting is publicly accessible via API (for client-side use)
   */
  @Prop({
    default: false
  })
  public: boolean;

  /**
   * Additional configuration data for the setting (validation rules, options, etc.)
   */
  @Prop({
    type: MongooseSchema.Types.Mixed
  })
  extra: any;

  /**
   * Data type of the setting value (text, number, boolean, select, etc.)
   */
  @Prop({
    default: 'text'
  })
  type: string;

  /**
   * Whether this setting is visible in admin interface
   */
  @Prop({
    default: true
  })
  visible: boolean;

  /**
   * Whether this setting can be edited via admin interface
   */
  @Prop({
    default: false
  })
  editable: boolean;

  /**
   * Whether this setting should be automatically loaded on system startup
   */
  @Prop({
    default: true
  })
  autoload: boolean;

  /**
   * Additional metadata for the setting (validation rules, UI hints, etc.)
   */
  @Prop({
    type: MongooseSchema.Types.Mixed
  })
  meta: Record<string, any>;

  /**
   * Timestamp when the setting was created
   */
  @Prop({
    type: Date,
    default: Date.now
  })
  createdAt: Date;

  /**
   * Last update timestamp
   */
  @Prop({
    type: Date,
    default: Date.now
  })
  updatedAt: Date;
}

export type SettingDocument = HydratedDocument<Setting>;

export const SettingSchema = SchemaFactory.createForClass(Setting);

/**
 * UNIQUE SETTING KEY INDEX
 *
 * Purpose: Ensure unique setting keys and enable efficient key-based lookup
 * Business Logic: System configuration, setting management
 *
 * Query Pattern:
 * - db.settings.findOne({ key: 'SITE_NAME' })
 * - Used for system configuration lookup and management
 *
 * Performance: O(log n) lookup for setting retrieval
 * Constraint: Ensures unique setting keys
 * Use Case: System configuration, setting management
 */
SettingSchema.index({ key: 1 }, {
  name: 'idx_key_unique',
  unique: true
});

/**
 * PUBLIC SETTINGS INDEX
 *
 * Purpose: Efficiently retrieve public settings for client-side access
 * Business Logic: Public configuration, client-side settings
 *
 * Query Pattern:
 * - db.settings.find({ public: true })
 * - Used for public settings API and client configuration
 *
 * Performance: Enables efficient public settings retrieval
 * Use Case: Public API, client-side configuration
 */
SettingSchema.index({ public: 1 }, {
  name: 'idx_public_settings'
});

/**
 * SETTING GROUP MANAGEMENT INDEX
 *
 * Purpose: Efficiently manage settings by group for admin interface
 * Business Logic: Setting organization, group-based management
 *
 * Query Pattern:
 * - db.settings.find({ group: '', visible: true })
 * - Used for admin setting management interface
 *
 * Performance: Enables efficient group-based setting queries
 * Use Case: Admin settings interface, group management
 */
SettingSchema.index({ group: 1, visible: 1 }, {
  name: 'idx_group_visible_admin'
});

/**
 * AUTOLOAD SETTINGS INDEX
 *
 * Purpose: Efficiently retrieve autoload settings for system initialization
 * Business Logic: System startup, configuration loading
 *
 * Query Pattern:
 * - db.settings.find({ autoload: true })
 * - Used for system initialization and configuration loading
 *
 * Performance: Enables efficient autoload settings retrieval
 * Use Case: System startup, configuration initialization
 */
SettingSchema.index({ autoload: 1 }, {
  name: 'idx_autoload_startup'
});
