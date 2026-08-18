import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { CustomThrottlerGuard } from 'src/common/guards/throttler.guard';
import { NotificationDto } from 'src/dtos/community/notification';
import { AuthUserDto } from 'src/dtos/identity/auth-user.dto';
import { EntityNotFoundException } from 'src/kernel';
import { PageableData } from 'src/kernel/common';
import { NotificationSearchRequestPayload } from 'src/payloads';
import { NotificationService } from 'src/services/community/notification';
import { AuthGuard, PaginationGuard } from '../../common/guards';
import { DataResponse } from '../../kernel';

/** Authenticated notification list and inbox-level read state. */
@ApiTags('Notification')
@ApiSecurity('token-auth')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) { }

  @Get('/')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, PaginationGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'List notifications',
    description: 'Paginated notifications for the authenticated user, most recent activity first. Supports cursor and offset pagination and optional type or category filters.'
  })
  @ApiQuery({ type: NotificationSearchRequestPayload })
  @ApiResponse({ status: HttpStatus.OK, description: 'Notifications retrieved successfully' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'User not authenticated' })
  async search(
    @Query() query: NotificationSearchRequestPayload,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<PageableData<NotificationDto>>> {
    return DataResponse.ok(await this.notificationService.search(query, user));
  }

  @Get('/unread-count')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({
    summary: 'Get unread notification count',
    description: 'Number of unread notifications for the authenticated user, used by the header badge.'
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Unread count retrieved successfully' })
  async unreadCount(
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<{ total: number }>> {
    return DataResponse.ok({ total: await this.notificationService.countUnread(user._id) });
  }

  @Delete('/:id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({
    summary: 'Delete one notification',
    description: 'Removes a single notification from the inbox of the authenticated user. Only the recipient can delete their own notification; the interaction it describes is not affected.'
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Notification deleted' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Notification not found for this user' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<{ deleted: boolean }>> {
    const result = await this.notificationService.deleteForRecipient(id, user._id);
    // A notification belonging to somebody else matches nothing, so it is
    // reported as missing rather than forbidden — the response must not confirm
    // that another user's notification exists.
    if (!result.deleted) throw new EntityNotFoundException();

    return DataResponse.ok(result);
  }

  @Put('/read-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary: 'Mark all notifications read',
    description: 'Marks every unread notification belonging to the authenticated user as read.'
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Notifications marked as read' })
  async markAllRead(
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<{ updated: number }>> {
    return DataResponse.ok(await this.notificationService.markAllRead(user._id));
  }
}
