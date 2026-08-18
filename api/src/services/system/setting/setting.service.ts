import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis'
import { Setting, SettingDocument } from 'src/schemas/system/setting';
import { Model } from 'mongoose';
import { SettingDto } from 'src/dtos/system/setting';
import { EntityNotFoundException } from 'src/kernel';
import { SettingUpdatePayload } from 'src/payloads/system/setting';
import { SETTING_KEYS } from 'src/common/constants/system';
import { FileServerService } from 'src/services/shared/file-server';

/**
 * Setting Service
 *
 * Core service for managing system-wide configuration settings with caching,
 * real-time updates, and public/private access control. Handles application
 * configuration, feature flags, and user-facing settings.
 *
 * Key Features:
 * - System configuration management with key-value storage
 * - Multi-level caching for performance optimization
 * - Real-time setting updates via queue messaging
 * - Public/private setting visibility control
 * - Group-based setting organization
 * - Auto-loading settings for client applications
 * - Menu integration for navigation settings
 *
 * Setting Types:
 * - System configuration (database, API keys, etc.)
 * - Feature flags and toggles
 * - UI/UX configuration settings
 * - Commission and payment settings
 * - Public user-facing settings
 * - Administrative control settings
 *
 * Caching Strategy:
 * - Static in-memory cache for all settings
 * - Separate public settings cache for client access
 * - Queue-based cache invalidation and synchronization
 * - Multi-instance cache synchronization support
 *
 * Access Control:
 * - Public settings: Visible to all users
 * - Private settings: Admin/system access only
 * - Editable settings: Can be modified via admin interface
 * - Auto-load settings: Automatically sent to client applications
 *
 * @example Get a system setting
 * ```typescript
 * const setting = await settingService.get('site_name');
 * console.log(`Site name: ${setting.value}`);
 * ```
 *
 * @example Get public settings for client
 * ```typescript
 * const publicSettings = await settingService.getPublicSettings();
 * // Includes menus, site info, and other public configuration
 * ```
 *
 * @example Update a setting with cache invalidation
 * ```typescript
 * const updated = await settingService.update('maintenance_mode', {
 *   value: true,
 *   description: 'Site under maintenance'
 * });
 * // Automatically publishes change to all instances
 * ```
 *
 * TODO: Implement Redis-based cache synchronization for multi-instance deployments
 */
// Dedicated Redis pub/sub channel for broadcasting setting changes to ALL instances.
// BullMQ uses competing consumers (only one instance processes each job), so it
// cannot be used for in-memory cache fan-out across instances.
const SETTING_CHANGE_PUBSUB_CHANNEL = 'setting:change';

@Injectable()
export class SettingService implements OnModuleInit, OnModuleDestroy {
  static _settingCache: Record<string, any> = {};

  // key and value
  static _publicSettingsCache: Record<string, any> = {};

  private readonly logger = new Logger(SettingService.name);

  // Dedicated subscriber connection — Redis requires a separate connection
  // once a client enters subscribe mode (cannot send regular commands on it).
  private settingChangeSubscriber: Redis;

  constructor(
    @InjectModel(Setting.name) private readonly SettingModel: Model<SettingDocument>,
    @InjectRedis() private readonly redisClient: Redis,
    private readonly fileServerService: FileServerService
  ) { }

  onModuleInit() {
    this.initSettingChangeListener();
  }

  async onModuleDestroy() {
    await this.settingChangeSubscriber?.quit();
  }

  // Public methods
  public async syncCache(): Promise<void> {
    // Distributed lock: only one instance runs the full cache rebuild at a time.
    // TTL of 30s covers worst-case initialization; the lock is released in finally.
    const LOCK_KEY = 'SETTING_CACHE_SYNC_LOCK';
    const LOCK_TTL_SECONDS = 30;
    const acquired = await this.redisClient.set(LOCK_KEY, '1', 'EX', LOCK_TTL_SECONDS, 'NX');
    if (!acquired) return; // another instance is already syncing

    try {
      const settings = await this.SettingModel.find();
      SettingService._settingCache = {};
      SettingService._publicSettingsCache = {};
      settings.forEach((setting) => {
        const dto = SettingDto.fromModel(setting);
        SettingService._settingCache[dto.key] = dto;
        if (dto.visible && dto.public) {
          SettingService._publicSettingsCache[dto.key] = dto.value;
        }
      });
    } finally {
      await this.redisClient.del(LOCK_KEY);
    }
  }

  async getAutoloadPublicSettingsForUser(): Promise<Record<string, any>> {
    const autoloadSettings: Record<string, any> = {};
    return Object.keys(SettingService._settingCache).reduce((settings, key) => {
      const results = settings;
      const setting = SettingService._settingCache[key];
      if (setting.autoload && setting.visible && setting.public) {
        results[key] = setting.value;
      }
      return results;
    }, autoloadSettings);
  }

  async getPublicSettingsForUserByGroup(group: string): Promise<Record<string, any>> {
    const groupSettings: Record<string, any> = {};
    return Object.keys(SettingService._settingCache).reduce((settings, key) => {
      const results = settings;
      const setting = SettingService._settingCache[key];
      if (setting.group === group && setting.visible && setting.public) {
        results[key] = setting.value;
      }
      return results;
    }, groupSettings);
  }

  getPublicValueByKeys(keys: string[]) {
    return keys.reduce((lp, key) => {
      const results = lp;
      results[key] = SettingService._publicSettingsCache[key];
      return results;
    }, {} as Record<string, any>);
  }

  /**
    * get all settings which are editable
    */
  async getEditableSettings(group?: string): Promise<SettingDto[]> {
    const query: Record<string, any> = { editable: true };
    if (group) {
      query.group = group;
    }
    // custom sort odering
    const settings = await this.SettingModel.find(query).sort({ ordering: 'asc' });
    return settings.map((s) => SettingDto.fromModel(s));
  }

  async update(key: string, data: SettingUpdatePayload): Promise<SettingDto> {
    const setting = await this.SettingModel.findOne({ key });
    if (!setting) {
      throw new EntityNotFoundException();
    }
    const previousValue = setting.value;
    data.description && setting.set('description', data.description);
    data.name && setting.set('name', data.name);
    setting.set('value', data.value);
    await setting.save();
    const dto = SettingDto.fromModel(setting);
    this.applyCacheChange(dto);
    await this.publishChange(dto);
    await this.addSettingFileRef(setting, previousValue, data.value);
    await this.cleanupReplacedSettingFile(key, previousValue, data.value);
    return dto;
  }

  // Broadcasts a setting change to ALL running instances via Redis pub/sub.
  // The publishing instance also receives the message through its own subscriber.
  private async publishChange(setting: SettingDto) {
    await this.redisClient.publish(SETTING_CHANGE_PUBSUB_CHANNEL, JSON.stringify(new SettingDto(setting)));
  }

  private initSettingChangeListener() {
    this.settingChangeSubscriber = this.redisClient.duplicate();
    this.settingChangeSubscriber.on('error', (err: any) => {
      if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
        this.logger.error('Setting change subscriber error', err);
      }
    });
    this.settingChangeSubscriber.subscribe(SETTING_CHANGE_PUBSUB_CHANNEL);
    this.settingChangeSubscriber.on('message', (_channel: string, message: string) => {
      try {
        this.applyCacheChange(new SettingDto(JSON.parse(message)));
      } catch (error) {
        this.logger.error('Failed to process setting change message', error);
      }
    });
  }

  private applyCacheChange(setting: SettingDto) {
    SettingService._settingCache[setting.key] = setting;
    if (setting.visible && setting.public) {
      SettingService._publicSettingsCache[setting.key] = setting.value;
    } else {
      delete SettingService._publicSettingsCache[setting.key];
    }
  }

  private async cleanupReplacedSettingFile(key: string, previousValue: any, nextValue: any) {
    if (!this.isFileSettingKey(key) || !previousValue || previousValue === nextValue) {
      return;
    }

    const previousFileId = this.extractFileIdFromSettingValue(previousValue);
    const nextFileId = this.extractFileIdFromSettingValue(nextValue);
    if (!previousFileId || previousFileId === nextFileId) {
      return;
    }

    try {
      await this.fileServerService.deleteManyByIds([previousFileId]);
    } catch (error) {
      this.logger.warn(`Failed to delete replaced setting file ${previousFileId}: ${error.message}`);
    }
  }

  private async addSettingFileRef(setting: SettingDocument, previousValue: any, nextValue: any) {
    if (!this.isFileSettingKey(setting.key) || !nextValue || previousValue === nextValue) {
      return;
    }

    const nextFileId = this.extractFileIdFromSettingValue(nextValue);
    if (!nextFileId) {
      return;
    }

    try {
      await this.fileServerService.addRef(nextFileId, {
        itemId: setting._id as any,
        itemType: `setting:${setting.key}`
      });
    } catch (error) {
      this.logger.warn(`Failed to add setting file reference ${nextFileId}: ${error.message}`);
    }
  }

  private isFileSettingKey(key: string) {
    const fileSettingKeys = new Set<string>([
      SETTING_KEYS.SITE_LOGO_URL,
      SETTING_KEYS.SITE_WHITE_LOGO_URL,
      SETTING_KEYS.SITE_FAVICON_URL,
      SETTING_KEYS.SITE_PAGE_LOADING_ICON_URL,
      SETTING_KEYS.SITE_MAINTENANCE_IMAGE_URL
    ]);

    return fileSettingKeys.has(key);
  }

  private extractFileIdFromSettingValue(value: any): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const match = value.match(/\/(?:photos|videos|files|uploads)\/([a-fA-F0-9]{24})(?:\/|$)/);
    return match?.[1] || null;
  }
}
