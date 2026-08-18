import { Expose, plainToInstance } from 'class-transformer';
import { FileServerInfoDto } from 'src/dtos/shared/file-server/file-server.dto';

export class PostPhotoDraftDto {
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
  updatedAt: string;

  static fromFile(file: FileServerInfoDto): PostPhotoDraftDto {
    return plainToInstance(PostPhotoDraftDto, {
      fileId: file._id.toString(),
      name: file.originalName || file.name,
      size: file.originalFileSize || file.size,
      status: file.status,
      processingStatus: file.processingStatus,
      url: file.url,
      updatedAt: file.updatedAt
    }, { excludeExtraneousValues: true });
  }
}

export class PostPhotoDraftDiscardDto {
  @Expose()
  discardedFileIds: string[];

  @Expose()
  missingFileIds: string[];

  static create(discardedFileIds: string[], missingFileIds: string[]): PostPhotoDraftDiscardDto {
    return plainToInstance(
      PostPhotoDraftDiscardDto,
      { discardedFileIds, missingFileIds },
      { excludeExtraneousValues: true }
    );
  }
}
