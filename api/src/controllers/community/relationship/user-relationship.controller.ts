import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RelationshipType } from 'src/common/constants/community';
import { CurrentUser } from 'src/common/decorators/auth-user.decorator';
import { AuthGuard } from 'src/common/guards';
import { CustomThrottlerGuard } from 'src/common/guards/throttler.guard';
import { AuthUserDto } from 'src/dtos/identity/auth-user.dto';
import { DataResponse } from 'src/kernel';
import { UserRelationshipPayload } from 'src/payloads/community/relationship';
import { RelationshipState, UserRelationshipService } from 'src/services/community/relationship';

/**
 * The two flags a user can set on another user: block and restrict.
 *
 * Deliberately not part of the follow routes. A follow is about content; these
 * are about who may reach you, and merging them is what made "unfollow to stop
 * the messages" the only tool people had.
 *
 * There is no endpoint that reports whether *somebody else* has flagged the
 * caller, and there never should be: a restrict is only useful while the person
 * it is set on cannot confirm it.
 */
@ApiTags('Relationship')
@ApiSecurity('token-auth')
@Controller('users')
export class UserRelationshipController {
  constructor(
    private readonly relationshipService: UserRelationshipService
  ) {}

  @Post('/:userId/relationships')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Block or restrict a user',
    description: 'Sets one flag on another user. `block` stops messages in both directions; `restrict` is one-way and stops that person sending to the caller. Idempotent: setting a flag that is already set succeeds without creating a second one. Neither flag is reversed by a follow, a mutual follow, or by the caller replying — only the matching DELETE gives the permission back.'
  })
  @ApiParam({ name: 'userId', description: 'The user being flagged', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Flag set' })
  async set(
    @Param('userId') userId: string,
    @Body() payload: UserRelationshipPayload,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<RelationshipState>> {
    await this.relationshipService.set(user._id, userId, payload.type as RelationshipType);
    return DataResponse.ok(await this.relationshipService.getState(user._id, userId));
  }

  @Delete('/:userId/relationships/:type')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({
    summary: 'Unblock or unrestrict a user',
    description: 'Clears one flag. This is the only thing that restores the permission — answering a restricted person, or the two of you following each other, deliberately does not.'
  })
  @ApiParam({ name: 'userId', description: 'The user being unflagged', example: '507f1f77bcf86cd799439011' })
  @ApiParam({ name: 'type', description: 'Flag to clear', example: 'restrict' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Flag cleared' })
  async clear(
    @Param('userId') userId: string,
    @Param('type') type: string,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<RelationshipState>> {
    await this.relationshipService.clear(user._id, userId, type as RelationshipType);
    return DataResponse.ok(await this.relationshipService.getState(user._id, userId));
  }
}
