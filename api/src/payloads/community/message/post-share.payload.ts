import { IsMongoId, IsNotEmpty } from 'class-validator';

/**
 * Body of a share into a direct message.
 *
 * Carries ids and nothing else. The post's title, thumbnail and author are
 * never accepted from the client: they would be a claim about content the
 * sender may not even be able to see, and the server has to read the post
 * anyway to check that both people may.
 *
 * One recipient per call. Sharing to several people is several calls, so a
 * refusal for one — blocked, restricted, already waiting on a reply — reports
 * against that person and leaves the others alone.
 */
export class PostSharePayload {
  @IsNotEmpty()
  @IsMongoId()
  recipientId: string;
}
