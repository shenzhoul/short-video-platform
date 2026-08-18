import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Injectable,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe
} from "@nestjs/common";
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser, Roles } from "src/common/decorators";
import { IpAddress } from "src/common/decorators/utils";
import { AuthGuard, CustomThrottlerGuard, PaginationGuard, RoleGuard } from "src/common/guards";
import { PostDto } from "src/dtos/content";
import { AuthUserDto } from "src/dtos/identity/auth-user.dto";
import { DataResponse } from "src/kernel";
import { PageableData } from "src/kernel/common";
import { PostCreatePayload, PostSearchRequest } from "src/payloads";
import { PostService } from "src/services";
import { ContentFileService, ContentService } from "src/services/content";
import { __t } from "src/utils/translation";

@Injectable()
@ApiTags('Creator Posts')
@ApiSecurity('token-auth')
@Controller('creator/posts')
export class CreatorPostController {
  constructor(
    private readonly postService: PostService,
    private readonly contentService: ContentService,
    private readonly contentFileService: ContentFileService
  ) { }

  @Post('/')
  @Roles('user')
  @UseGuards(CustomThrottlerGuard, RoleGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 post creations per minute
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Create post',
    description: 'Create a new post as a creator. Requires creator role and document verification. Creator can only use their own uploaded files.'
  })
  @ApiBody({
    type: PostCreatePayload,
    description: 'Post creation data including content, files, and metadata'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Post created successfully',
    type: DataResponse
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid post data or validation error'
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated'
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Document verification required or insufficient permissions'
  })
  async create(
    @Body() payload: PostCreatePayload,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<any>> {
    // Check creator content permission (verified documents)
    const hasPermission = await this.contentService.checkCreatorContentPermission(user);
    if (!hasPermission) {
      throw new HttpException(
        __t('errors.document_verification_required_create'),
        HttpStatus.FORBIDDEN
      );
    }

    // Validate file ownership at controller level
    const validatedFiles = await this.contentFileService.validatePostFileOwnershipAndReturn(
      payload,
      user,
      'create'
    );

    const data = await this.postService.create(payload, user, validatedFiles);
    return DataResponse.ok(data);
  }

  @Get([
    '/',
    '/search'
  ])
  @Roles('user')
  @UseGuards(CustomThrottlerGuard, RoleGuard, PaginationGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } }) // 30 requests per minute
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Get my posts',
    description: 'Retrieve paginated list of posts created by the authenticated creator. Supports search and filtering.'
  })
  @ApiQuery({
    type: PostSearchRequest,
    description: 'Search and pagination parameters'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Posts retrieved successfully',
    type: DataResponse<PageableData<any>>
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated'
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'User does not have creator role'
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid search parameters'
  })
  async getMyPosts(
    @Query() query: PostSearchRequest,
    @CurrentUser() creator: AuthUserDto,
    @IpAddress() ip: string
  ): Promise<DataResponse<PageableData<any>>> {
    const data = await this.contentService.searchCreatorPosts(query, creator, {
      ip
    });
    return DataResponse.ok(data);
  }

  @Get('/:id')
  @Roles('user')
  @UseGuards(CustomThrottlerGuard, RoleGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } }) // 60 post detail requests per minute
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Get creator post by ID',
    description: 'Retrieves a specific post by its ID for the authenticated creator. Only the post owner can access their own posts.'
  })
  @ApiParam({
    name: 'id',
    description: 'Unique identifier of the post',
    type: 'string',
    example: '507f1f77bcf86cd799439011'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Post retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          $ref: '#/components/schemas/PostDto'
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated'
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'User does not have creator role or is not the post owner'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Post not found'
  })
  async getCreatorPost(
    @CurrentUser() user: AuthUserDto,
    @Param('id') id: string,
    @IpAddress() ip: string
  ): Promise<DataResponse<PostDto>> {
    const data = await this.contentService.findPostDetails(id, user, {
      ip
    });
    return DataResponse.ok(data);
  }

  @Put('/:id')
  @Roles('user')
  @UseGuards(CustomThrottlerGuard, RoleGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 post updates per minute
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Update creator post',
    description: 'Updates an existing post by its ID for the authenticated creator. Requires document verification and validates file ownership before updating.'
  })
  @ApiParam({
    name: 'id',
    description: 'Unique identifier of the post to update',
    type: 'string',
    example: '507f1f77bcf86cd799439011'
  })
  @ApiBody({
    type: PostCreatePayload,
    description: 'Post update payload with new content and file references'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Post updated successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: 'Updated post data'
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated'
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'User does not have creator role, is not the post owner, or document verification required'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Post not found'
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid request payload or file ownership validation failed'
  })
  async updatePost(
    @CurrentUser() user: AuthUserDto,
    @Param('id') id: string,
    @Body() payload: PostCreatePayload
  ): Promise<DataResponse<any>> {
    // Check creator content permission (verified documents)
    const hasPermission = await this.contentService.checkCreatorContentPermission(user);
    if (!hasPermission) {
      throw new HttpException(
        __t('errors.document_verification_required_update'),
        HttpStatus.FORBIDDEN
      );
    }

    // Validate file ownership at controller level
    const validatedFiles = await this.contentFileService.validatePostFileOwnershipAndReturn(
      payload,
      user,
      'update'
    );

    const data = await this.postService.updatePost(id, user, payload, validatedFiles);
    return DataResponse.ok(data);
  }

  @Put('/:id/pin')
  @Roles('user')
  @UseGuards(AuthGuard, CustomThrottlerGuard, RoleGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pin an owned post to the top of creator lists' })
  async pinPost(
    @CurrentUser() user: AuthUserDto,
    @Param('id') id: string
  ): Promise<DataResponse<PostDto>> {
    return DataResponse.ok(await this.postService.setPinned(id, user, true));
  }

  @Delete('/:id/pin')
  @Roles('user')
  @UseGuards(AuthGuard, CustomThrottlerGuard, RoleGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove an owned post from the top of creator lists' })
  async unpinPost(
    @CurrentUser() user: AuthUserDto,
    @Param('id') id: string
  ): Promise<DataResponse<PostDto>> {
    return DataResponse.ok(await this.postService.setPinned(id, user, false));
  }

  @Delete('/:id')
  @Roles('user')
  @UseGuards(CustomThrottlerGuard, RoleGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 post deletions per minute
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Delete creator post',
    description: 'Deletes an existing post by its ID for the authenticated creator. Requires document verification and only the post owner can delete their posts.'
  })
  @ApiParam({
    name: 'id',
    description: 'Unique identifier of the post to delete',
    type: 'string',
    example: '507f1f77bcf86cd799439011'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Post deleted successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: 'Deletion confirmation data'
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated'
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'User does not have creator role, is not the post owner, or document verification required'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Post not found'
  })
  async deleteCreatorPost(
    @CurrentUser() user: AuthUserDto,
    @Param('id') id: string
  ): Promise<DataResponse<any>> {
    // Check creator content permission (verified documents)
    const hasPermission = await this.contentService.checkCreatorContentPermission(user);
    if (!hasPermission) {
      throw new HttpException(
        __t('errors.document_verification_required_delete'),
        HttpStatus.FORBIDDEN
      );
    }

    const data = await this.postService.deletePost(id, user);
    return DataResponse.ok(data);
  }
}
