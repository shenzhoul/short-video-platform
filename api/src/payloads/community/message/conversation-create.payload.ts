import { IsMongoId, IsNotEmpty, IsString } from 'class-validator';

/**
 * Open (or reopen) the direct conversation with one other user.
 *
 * Only the other participant is accepted. The caller is the authenticated user,
 * so a client cannot open a conversation between two other people.
 */
export class ConversationCreatePayload {
  @IsString()
  @IsNotEmpty()
  @IsMongoId()
  participantId: string;
}
