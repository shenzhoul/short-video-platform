import { Expose, plainToInstance, Transform } from 'class-transformer';
import { ObjectId } from 'mongodb';
import { FileServerInfoDto } from 'src/dtos/shared/file-server/file-server.dto';

/**
 * One message as the client renders it.
 *
 * `files` is resolved from `fileIds` against the file server, so a bubble has
 * everything it needs — url, dimensions, thumbnails, processing status — without
 * a second request per attachment. Dimensions matter here specifically: a media
 * bubble reserves its aspect ratio before the image loads, so an arriving photo
 * does not shove the thread's scroll position.
 *
 * This is also the socket payload, so it stays flat and small.
 */
export class MessageDto {
  @Expose()
  @Transform(({ obj }) => obj._id)
  _id: ObjectId;

  @Expose()
  @Transform(({ obj }) => obj.conversationId)
  conversationId: ObjectId;

  @Expose()
  type: string;

  @Expose()
  @Transform(({ obj }) => obj.fileIds)
  fileIds: ObjectId[];

  @Expose()
  text: string;

  @Expose()
  @Transform(({ obj }) => obj.senderId)
  senderId: ObjectId;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  /** Resolved attachments. Empty for a text message. */
  @Expose()
  files: Array<Record<string, any>>;

  public static fromModel(model: any): MessageDto | null {
    if (!model) return null;

    return plainToInstance(
      MessageDto,
      typeof model.toObject === 'function' ? model.toObject() : model,
      { excludeExtraneousValues: true }
    );
  }

  public setFiles(files: FileServerInfoDto[] | null | undefined) {
    this.files = (files || []).map(file => file.toPublicResponse({
      showThumbnails: true,
      // A direct message is not blurred content: both participants may see it
      // in full, so there is no placeholder variant to carry.
      showBlurImage: false
    }));
  }
}
