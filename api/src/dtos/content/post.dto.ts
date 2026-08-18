import { Expose, plainToInstance, Transform } from 'class-transformer';
import { ObjectId } from 'mongodb';
import { UserDto } from 'src/dtos/identity/user/user.dto';
import { FileServerInfoDto } from 'src/dtos/shared/file-server/file-server.dto';

export class PostDto {
  @Expose()
  @Transform(({ obj }) => obj._id)
  _id: ObjectId | string;

  @Expose()
  type: string;

  @Expose()
  @Transform(({ obj }) => obj.userId)
  userId: ObjectId | string;

  @Expose()

  @Expose()
  title: string;

  @Expose()
  text: string;

  @Expose()
  tags: string[];

  @Expose()
  topicKey: string | null;

  @Expose()
  associatedTag: string | null;

  @Expose()
  @Transform(({ obj }) => obj.mentionedUserIds)
  mentionedUserIds: Array<string | ObjectId>;

  @Expose()
  @Transform(({ obj }) => obj.fileIds)
  fileIds: Array<string | ObjectId>;

  @Expose()
  totalLike: number;

  @Expose()
  totalComment: number;

  @Expose()
  totalShare: number;

  @Expose()
  totalView: number;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  isLiked: boolean;

  @Expose()
  user: Partial<UserDto>;

  @Expose()
  files: Array<Partial<FileServerInfoDto | Record<string, any>>>;


  @Expose()
  orientation: string;

  @Expose()
  @Transform(({ obj }) => obj.teaserId)
  teaserId: ObjectId;

  @Expose()
  teaser: Record<string, any>;

  @Expose()
  @Transform(({ obj }) => obj.thumbnailId)
  thumbnailId: ObjectId;

  @Expose()
  thumbnailUrl: string;

  @Expose()
  @Transform(({ obj }) => obj.cover4x3Id)
  cover4x3Id: ObjectId;

  @Expose()
  @Transform(({ obj }) => obj.cover3x4Id)
  cover3x4Id: ObjectId;

  @Expose()
  cover4x3Url: string;

  @Expose()
  cover3x4Url: string;

  @Expose()
  coverDisplayRatio: '4:3' | '3:4';

  @Expose()
  tagline: string;

  @Expose()
  status: string;

  @Expose()
  isCreatorDeleted?: boolean;

  @Expose()
  isPinned: boolean;

  @Expose()
  pinnedAt: Date | null;

  public static fromModel(model) {
    if (!model) return null;

    return plainToInstance(PostDto, typeof model.toObject === 'function' ? model.toObject() : model, { excludeExtraneousValues: true });
  }

  public async setFiles(files: FileServerInfoDto[]): Promise<any> {
    if (!files?.length) return;

    this.files = await files.reduce(async (res, file) => {
      const results = await res;
      const item = {
        ...(await file.toPublicResponse()),
        blurImage: await file.getBlurImage()
      };
      results.push(item);
      return results;
    }, [] as any);
  }

  setIsLiked(value: boolean) {
    this.isLiked = value;
  }

  async setThumbnail(thumbnail: FileServerInfoDto): Promise<any> {
    if (!thumbnail) return;
    // TODO - check me
    this.thumbnailUrl = await thumbnail.getUrl();
  }

  async setCovers(cover4x3?: FileServerInfoDto, cover3x4?: FileServerInfoDto): Promise<void> {
    if (cover4x3) this.cover4x3Url = await cover4x3.getUrl();
    if (cover3x4) this.cover3x4Url = await cover3x4.getUrl();
    this.cover4x3Url ||= this.thumbnailUrl;
    this.cover3x4Url ||= this.cover4x3Url;
    this.coverDisplayRatio ||= '4:3';
  }

  async setTeaser(teaser: FileServerInfoDto): Promise<any> {
    if (!teaser) return;
    this.teaser = await teaser.toPublicResponse();
  }

  setUser(user: UserDto) {
    if (!user) return;
    this.user = user.toSearchResponse();
  }
}
