import {
  IsIn, IsMongoId,
  IsNotEmpty, IsOptional, IsString
} from 'class-validator';
import { ObjectId } from 'mongodb';
import { REACTION_TARGET_TYPES, REACTION_TYPES } from 'src/common/constants/community';

export class ReactionCreatePayload {
  @IsString()
  @IsOptional()
  @IsIn([
    REACTION_TARGET_TYPES.COMMENT,
    REACTION_TARGET_TYPES.POST,
    REACTION_TARGET_TYPES.CREATOR
  ])
  objectType = REACTION_TARGET_TYPES.POST;

  @IsString()
  @IsOptional()
  @IsIn([
    REACTION_TYPES.LIKE,
    REACTION_TYPES.SHARE
  ])
  action: string;

  @IsString()
  @IsNotEmpty()
  @IsMongoId()
  objectId: string | ObjectId;
}

/**
 * Body for the toggle endpoint.
 *
 * Share is deliberately excluded: it has no meaningful "un-share", so it is
 * recorded through its own endpoint rather than a toggle.
 */
export class ReactionCreateRequestPayload {
  @IsString()
  @IsOptional()
  @IsIn([
    REACTION_TYPES.LIKE
  ])
  action: string;
}
