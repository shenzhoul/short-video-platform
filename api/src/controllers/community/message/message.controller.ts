import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe
} from '@nestjs/common';
import {
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from 'src/common/decorators/auth-user.decorator';
import { AuthGuard, PaginationGuard } from 'src/common/guards';
import { CustomThrottlerGuard } from 'src/common/guards/throttler.guard';
import { MessageDto } from 'src/dtos/community/message';
import { AuthUserDto } from 'src/dtos/identity/auth-user.dto';
import { DataResponse } from 'src/kernel';
import { PageableData } from 'src/kernel/common';
import { MessageCreatePayload, MessageSearchPayload } from 'src/payloads/community/message';
import {
  ConversationParticipantService,
  MessageService,
  SendMessageResult
} from 'src/services/community/message';
import type { MessageUnreadTotals } from 'src/services/community/message';

/** Messages inside a direct conversation, and inbox-level unread state. */
@ApiTags('Message')
@ApiSecurity('token-auth')
@Controller('messages')
export class MessageController {
  constructor(
    private readonly messageService: MessageService,
    private readonly participantService: ConversationParticipantService
  ) {}

  @Get('/unread-count')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({
    summary: 'Get unread message totals',
    description: 'Both totals for the authenticated user. `totalUnreadMessages` is how many messages are waiting; `totalUnreadConversations` is how many people are waiting. The header indicator shows when `totalUnreadMessages` is above zero.'
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Unread totals retrieved successfully' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'User not authenticated' })
  async unreadCount(
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<MessageUnreadTotals>> {
    return DataResponse.ok(await this.participantService.getUnreadTotals(user._id));
  }

  @Put('/read-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary: 'Mark all conversations read',
    description: 'Clears every unread conversation for the authenticated user. Persisted server-side, so the cleared state survives a reload and reaches the user\'s other sessions.'
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Conversations marked read' })
  async markAllRead(
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<{ updated: number }>> {
    return DataResponse.ok(await this.messageService.markAllRead(user));
  }

  @Get('/conversations/:conversationId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, PaginationGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'List messages in a conversation',
    description: 'Message history for a conversation the caller belongs to, newest first, cursor paginated. A conversation the caller is not part of is reported as not found.'
  })
  @ApiQuery({ type: MessageSearchPayload })
  @ApiResponse({ status: HttpStatus.OK, description: 'Messages retrieved successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Conversation not found for this user' })
  async search(
    @Param('conversationId') conversationId: string,
    @Query() query: MessageSearchPayload,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<PageableData<MessageDto>>> {
    return DataResponse.ok(await this.messageService.search(conversationId, query, user));
  }

  @Post('/conversations/:conversationId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Send a message',
    description: 'Sends one message. Permission is decided here on every send from the current follow relation: mutual followers may message freely, and a non-mutual sender may have only one unanswered message outstanding until the other person replies. A refused send returns 403.'
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Message sent' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Sender is waiting for a reply, or does not own an attached file' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Conversation not found for this user' })
  async send(
    @Param('conversationId') conversationId: string,
    @Body() payload: MessageCreatePayload,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<SendMessageResult>> {
    return DataResponse.ok(await this.messageService.send(conversationId, payload, user));
  }
}
