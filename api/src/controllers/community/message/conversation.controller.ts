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
import { ConversationDto } from 'src/dtos/community/message';
import { AuthUserDto } from 'src/dtos/identity/auth-user.dto';
import { DataResponse } from 'src/kernel';
import { PageableData } from 'src/kernel/common';
import {
  ConversationCreatePayload,
  ConversationSearchPayload
} from 'src/payloads/community/message';
import { ConversationService, MessageService } from 'src/services/community/message';

/**
 * Direct conversations for the authenticated user.
 *
 * Every route derives the reader from the session, never from a request field,
 * so no client can list or open somebody else's conversations.
 */
@ApiTags('Conversation')
@ApiSecurity('token-auth')
@Controller('conversations')
export class ConversationController {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService
  ) {}

  @Get('/')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, PaginationGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'List conversations',
    description: 'Conversations for the authenticated user, most recent activity first. Each row carries the other participant, this user\'s unread count and the current send permission, so the list renders without follow-up requests. Supports cursor and offset pagination and an optional keyword match on the other participant.'
  })
  @ApiQuery({ type: ConversationSearchPayload })
  @ApiResponse({ status: HttpStatus.OK, description: 'Conversations retrieved successfully' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'User not authenticated' })
  async search(
    @Query() query: ConversationSearchPayload,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<PageableData<ConversationDto>>> {
    return DataResponse.ok(await this.conversationService.search(user._id, query));
  }

  @Post('/')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Open a conversation',
    description: 'Returns the direct conversation with the given user, creating it if this is the first contact. One pair of users always resolves to the same conversation regardless of who opens it first.'
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Conversation opened' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Cannot open a conversation with yourself' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Participant not found' })
  async open(
    @Body() payload: ConversationCreatePayload,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<ConversationDto>> {
    return DataResponse.ok(
      await this.conversationService.findOrCreateDirectConversation(user._id, payload.participantId)
    );
  }

  @Get('/:id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({
    summary: 'Get one conversation',
    description: 'Conversation detail for one of its members, including live send permission. A conversation the caller is not part of is reported as not found rather than forbidden, so an id cannot be probed for existence.'
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Conversation retrieved' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Conversation not found for this user' })
  async detail(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<ConversationDto>> {
    return DataResponse.ok(await this.conversationService.getDetail(id, user._id));
  }

  @Put('/:id/read')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @ApiOperation({
    summary: 'Mark a conversation read',
    description: 'Clears the authenticated user\'s unread count for one conversation. Reading is per user and never affects the other participant, and it does not release any messaging restriction — only a reply does that.'
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Conversation marked read' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Conversation not found for this user' })
  async markRead(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<{ cleared: number }>> {
    return DataResponse.ok(await this.messageService.markConversationRead(id, user));
  }
}
