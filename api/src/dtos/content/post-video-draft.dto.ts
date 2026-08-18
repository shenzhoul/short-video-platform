import { Expose, plainToInstance } from 'class-transformer';
import { FileServerInfoDto } from 'src/dtos/shared/file-server/file-server.dto';

export class PostVideoDraftDto {
  @Expose()
  fileId: string;

  @Expose()
  name: string;

  @Expose()
  size: number;

  @Expose()
  status: string;

  @Expose()
  processingStatus?: string;

  @Expose()
  url?: string;

  @Expose()
  thumbnails?: string[];

  @Expose()
  blurImage?: string;

  @Expose()
  updatedAt: string;

  static fromFile(file: FileServerInfoDto): PostVideoDraftDto {
    return plainToInstance(PostVideoDraftDto, {
      fileId: file._id.toString(),
      name: file.originalName || file.name,
      size: file.originalFileSize || file.size,
      status: file.status,
      processingStatus: file.processingStatus,
      url: file.url,
      thumbnails: file.getThumbnailUrls(),
      blurImage: file.blurImage,
      updatedAt: file.updatedAt
    }, { excludeExtraneousValues: true });
  }
}

export class PostVideoDraftDiscardDto {
  @Expose()
  discarded: boolean;

  @Expose()
  fileId: string;

  static create(fileId: string, discarded: boolean): PostVideoDraftDiscardDto {
    return plainToInstance(
      PostVideoDraftDiscardDto,
      { discarded, fileId },
      { excludeExtraneousValues: true }
    );
  }
}
