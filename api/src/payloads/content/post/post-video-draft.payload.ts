import { IsMongoId } from 'class-validator';

export class PostVideoDraftPayload {
  @IsMongoId()
  fileId: string;
}
