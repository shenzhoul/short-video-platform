import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { RELATIONSHIP_TYPE_LIST } from 'src/common/constants/community';

/**
 * Which flag to set or clear on another user.
 *
 * The type is a path-free body field so one route pair covers both flags; the
 * alternative was four near-identical endpoints that would drift apart.
 */
export class UserRelationshipPayload {
  @IsNotEmpty()
  @IsString()
  @IsIn(RELATIONSHIP_TYPE_LIST)
  type: string;
}
