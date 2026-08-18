import { Expose, plainToInstance, Transform } from 'class-transformer';
import { ObjectId } from 'mongodb';
import appConfig from 'src/config/app';
import fileConfig from 'src/config/file';
import { getExt, isUrl } from 'src/kernel/helpers/string.helper';
import { StorageService } from 'src/services/file/storage.service';

export class FileDto {
  @Expose()
  @Transform(({ obj }) => obj._id)
  _id: ObjectId;

  @Expose()
  @Transform(({ obj }) => obj._id)
  fileId: string; // compatible with tus

  @Expose()
  type: string; // video, podcast, file, etc...

  @Expose()
  name: string;

  @Expose()
  originalName: string;

  @Expose()
  fileExtension: string;

  @Expose()
  description: string;

  @Expose()
  mimeType: string;

  @Expose()
  storageType: string;

  @Expose()
  path: string; // path of key in local or server

  @Expose()
  absolutePath: string;

  @Expose()
  width: number; // for video, img

  @Expose()
  height: number; // for video, img

  @Expose()
  duration: number; // for video, podcast

  @Expose()
  fileSize: number; // in byte (renamed from size to match schema)

  @Expose()
  originalFileSize: number; // original file size before processing

  @Expose()
  processingStatus: string; // processing, completed, failed

  @Expose()
  status: string; // active, inactive, deleted

  @Expose()
  encoding: string;

  @Expose()
  uploadMethod: string; // regular, tus, etc.

  @Expose()
  @Transform(({ obj }) => obj.thumbnails)
  thumbnails: Array<{
    size: string;
    path: string;
    absolutePath?: string;
    width: number;
    height: number;
    fileSize: number;
  }>;

  @Expose()
  blurImagePath: string;

  @Expose()
  @Transform(({ obj }) => obj.refItems)
  refItems: Array<{
    itemType: string;
    itemId: ObjectId;
  }>;

  @Expose()
  acl: string;

  @Expose()
  isProtected: boolean;

  @Expose()
  @Transform(({ obj }) => obj.metadata)
  metadata: Record<string, any>;

  @Expose()
  @Transform(({ obj }) => obj.processingError)
  processingError: any;

  @Expose()
  uploadedAt: Date;

  @Expose()
  processedAt: Date;

  @Expose()
  @Transform(({ obj }) => obj.createdBy)
  createdBy: ObjectId;

  @Expose()
  @Transform(({ obj }) => obj.updatedBy)
  updatedBy: ObjectId;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  public static fromModel(model: any) {
    if (!model) return null;

    return plainToInstance(FileDto, typeof model.toObject === 'function' ? model.toObject() : model, { excludeExtraneousValues: true });
  }

  static getPublicUrl(filePath: string): string {
    if (!filePath) return '';
    if (isUrl(filePath)) return filePath;
    return new URL(filePath, appConfig.baseUrl).href;
  }

  public getPublicPath() {
    if (this.absolutePath) {
      return this.absolutePath.replace(fileConfig.publicDir, '');
    }

    return this.path || '';
  }

  public async getUrl(authenticated = false, options: Record<string, any> = {}): Promise<string> {
    const {
      expiresIn = 60 * 60,
      download = false,
      ip = ''
    } = options || {};
    // if it is public read, we won't provide authenticated due to cache option?
    let overwriteAuth = authenticated;
    if (!authenticated && this.acl === 'public-read') overwriteAuth = true;
    return StorageService.getFileUrl(this.path, {
      authenticated: this.acl !== 'public-read' && overwriteAuth, // TODO - should check me
      expiresIn,
      download,
      storageType: this.storageType,
      ip
    });
  }

  public async getThumbnails(): Promise<string[]> {
    if (!this.thumbnails || !this.thumbnails.length) {
      return [];
    }

    const thumbs = await this.thumbnails.reduce(async (cb, t) => {
      const results = await cb;
      if (isUrl(t.path)) {
        results.push(t.path);
        return results;
      }

      // if it is public read, we won't provide authenticated due to cache option?
      const overwriteAuth = this.acl === 'public-read';
      const url = await StorageService.getFileUrl(t.path, {
        authenticated: overwriteAuth,
        expiresIn: 60 * 60,
        storageType: this.storageType
      });
      results.push(url);
      return results;
    }, [] as any);
    return thumbs;
  }

  public async getBlurImage(): Promise<string> {
    if (!this.blurImagePath) return null;
    const url = await StorageService.getFileUrl(this.blurImagePath, {
      authenticated: false, // here is use public-read for blur image, dont need to show hash
      expiresIn: 60 * 60,
      storageType: this.storageType
    });
    return url;
  }

  public isVideo() {
    return (this.mimeType || '').toLowerCase().includes('video');
  }

  public isImage() {
    const imageType = (this.mimeType || '').toLowerCase().includes('image');
    if (imageType) return true;
    // check other format
    return ['.heic', '.heif'].includes(getExt(this.absolutePath).toLowerCase());
  }

  public isPhoto() {
    return this.isImage();
  }

  public isAudio() {
    return (this.mimeType || '').toLowerCase().includes('audio') || (this.mimeType || '').toLowerCase().includes('video');
  }

  // TODO - double check me for file response
  public toResponse() {
    const data = { ...this };
    delete data.absolutePath;
    delete data.path;
    return data;
  }

  public async toPublicResponse(options?: {
    canView?: boolean,
    showThumbnails?: boolean;
    ip?: string;
  }) {
    const {
      canView = false,
      showThumbnails = true,
      ip = ''
    } = options || {};
    return {
      _id: this._id,
      fileId: this.fileId,
      type: this.type,
      name: this.name,
      mimeType: this.mimeType,
      width: this.width,
      height: this.height,
      duration: this.duration,
      url: canView ? await this.getUrl(canView, {
        ip
      }) : undefined,
      thumbnails: showThumbnails ? await this.getThumbnails() : [],
      status: this.status,
      blurImage: await this.getBlurImage()
    };
  }
}
