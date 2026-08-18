import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsMongoId } from 'class-validator';

export class PostPhotoDraftsPayload {
  @Transform(({ value }) => Array.isArray(value) ? value : [value])
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ArrayUnique()
  @IsMongoId({ each: true })
  fileIds: string[];
}
