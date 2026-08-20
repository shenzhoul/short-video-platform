import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf
} from 'class-validator';
import {
  MESSAGE_MAX_ATTACHMENTS,
  MESSAGE_TEXT_MAX_LENGTH,
  MESSAGE_TYPE_LIST,
  MESSAGE_TYPES
} from 'src/common/constants/community';
import { SanitizeHtmlStrict } from 'src/common/decorators/sanitize-html.decorator';

/**
 * Body of a new message.
 *
 * A message must carry something: text is required unless an attachment is
 * present, so an empty send is rejected by validation rather than creating a
 * blank bubble.
 */
export class MessageCreatePayload {
  @IsOptional()
  @IsString()
  @IsIn(MESSAGE_TYPE_LIST)
  type?: string = MESSAGE_TYPES.TEXT;

  @SanitizeHtmlStrict(MESSAGE_TEXT_MAX_LENGTH)
  @ValidateIf((o) => !o.fileIds || !o.fileIds.length)
  @IsString()
  @IsNotEmpty()
  text: string;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  @ArrayMaxSize(MESSAGE_MAX_ATTACHMENTS)
  fileIds?: string[];
}
