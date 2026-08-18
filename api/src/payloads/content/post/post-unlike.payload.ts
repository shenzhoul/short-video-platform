import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsMongoId
} from 'class-validator';

export class PostUnlikePayload {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsMongoId({ each: true })
  postIds: string[];
}
