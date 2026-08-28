import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags
} from '@nestjs/swagger';
import { CurrentUser, Roles } from 'src/common/decorators';
import { IpAddress } from 'src/common/decorators/utils';
import { PaginationGuard, RoleGuard } from 'src/common/guards';
import { AuthUserDto } from 'src/dtos/identity/auth-user.dto';
import { UserDto } from 'src/dtos/identity/user';
import { DataResponse } from 'src/kernel';
import { AdminUserCreatePayload, AdminUserUpdatePayload, UserSearchRequestPayload } from 'src/payloads';
import { UserAccountManagementService, UserSearchAndFilterService } from 'src/services/identity';

@Injectable()
@Controller('admin/users')
@ApiTags('Admin User Management')
@ApiSecurity('token-auth')
export class AdminUserController {
  constructor(
    private readonly userService: UserAccountManagementService,
    private readonly userSearchService: UserSearchAndFilterService
  ) { }

  @Get('/search')
  @Roles('admin')
  @UseGuards(RoleGuard, PaginationGuard)
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Search users',
    description: 'Admin endpoint to search and filter users with pagination. Requires admin role.'
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number for pagination',
    example: 1
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of items per page',
    example: 20
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    description: 'Sort field',
    example: 'createdAt'
  })
  @ApiQuery({
    name: 'sortType',
    required: false,
    description: 'Sort direction (asc/desc)',
    example: 'desc'
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Filter by user status',
    example: 'active'
  })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Search query',
    example: 'john'
  })
  @ApiResponse({
    status: 200,
    description: 'Users retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          description: 'Paginated user list with cursor information'
        }
      }
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid authentication'
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin role required'
  })
  async search(
    @Query() req: UserSearchRequestPayload
  ): Promise<DataResponse<{
    data: Partial<UserDto>[];
    hasMore: boolean;
    nextCursor?: {
      id: string;
      createdAt: number;
    };
    total?: number;
    paginationInfo?: {
      maxOffset: number;
      cursorPaginationAvailable: boolean;
    };
  }>> {
    const data = await this.userSearchService.search(req);
    return DataResponse.ok(data);
  }

  @Get('/search-all')
  @Roles('admin')
  @UseGuards(RoleGuard, PaginationGuard)
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Search users',
    description: 'Admin endpoint to search and filter users with pagination. Requires admin role.'
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number for pagination',
    example: 1
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of items per page',
    example: 20
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    description: 'Sort field',
    example: 'createdAt'
  })
  @ApiQuery({
    name: 'sortType',
    required: false,
    description: 'Sort direction (asc/desc)',
    example: 'desc'
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Filter by user status',
    example: 'active'
  })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Search query',
    example: 'john'
  })
  @ApiResponse({
    status: 200,
    description: 'Users retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          description: 'Paginated user list with cursor information'
        }
      }
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid authentication'
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin role required'
  })
  async searchAll(
    @Query() req: UserSearchRequestPayload
  ): Promise<DataResponse<{
    data: Partial<UserDto>[];
    hasMore: boolean;
    nextCursor?: {
      id: string;
      createdAt: number;
    };
    total?: number;
    paginationInfo?: {
      maxOffset: number;
      cursorPaginationAvailable: boolean;
    };
  }>> {
    return DataResponse.ok(await this.userSearchService.searchAll(req));
  }

  @Post('/')
  @Roles('admin')
  @UseGuards(RoleGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Create user account',
    description: 'Admin endpoint to create a new user account. Requires admin role.'
  })
  @ApiBody({
    type: AdminUserCreatePayload,
    description: 'User account creation data',
    examples: {
      'create-user': {
        summary: 'Create a new user account',
        value: {
          email: 'user@example.com',
          username: 'johndoe',
          password: 'password123',
          firstName: 'John',
          lastName: 'Doe',
          dateOfBirth: '1990-01-01'
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'User account created successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          description: 'Created user account details'
        }
      }
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid authentication'
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin role required'
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Invalid data or account already exists'
  })
  async createUser(
    @Body() payload: AdminUserCreatePayload
  ): Promise<DataResponse<Partial<UserDto>>> {
    // The status the administrator picked is forwarded as *intent*, not left in
    // the payload, because the service ignores request-shaped status on purpose.
    // This route is the boundary that makes it trustworthy: `RoleGuard` has
    // established the caller is an admin, and `AdminUserCreatePayload` has
    // already validated the value against `USER_STATUS`.
    //
    // Without this line the admin form's Status select was silently discarded and
    // every account came out `active` — an administrator creating a suspended
    // account got a working one, with no error to tell them otherwise.
    const user = await this.userService.createNewUserAccount(payload, {
      status: payload.status,
      // The administrator's own "Verified email" switch, forwarded as intent
      // rather than left in the payload for the same reason `status` is. Left
      // off (the default), the account is created unconfirmed and is sent a
      // confirmation email exactly like a self-registered one; switched on, the
      // administrator is vouching for the address and no mail is sent.
      verifiedEmail: payload.verifiedEmail === true
    });

    // No second `createAuthPassword` call here. `createNewUserAccount` already
    // stores the credential when the payload carries a password, so this route
    // used to write it twice — the same hash, hashed again with a second salt,
    // for no benefit. One credential write, in one place, shared with public
    // registration.

    // `verificationEmailQueued` distinguishes "the account was not created" from
    // "the account exists but its confirmation email has not gone out yet".
    // Those need different words in front of an administrator, and only one of
    // them is a reason to try again.
    return DataResponse.ok({
      ...new UserDto(user).toResponse(true),
      verificationEmailQueued: (user as any).verificationEmailQueued !== false
    });
  }

  @Put('/:id')
  @Roles('admin')
  @UseGuards(RoleGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async updateUser(
    @Body() payload: AdminUserUpdatePayload,
    @Param('id') userId: string
  ): Promise<DataResponse<any>> {
    await this.userService.adminUpdate(userId, payload);

    const user = await this.userService.findById(userId);
    return DataResponse.ok(new UserDto(user).toResponse(true));
  }

  @Get('/:id/view')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @UseGuards(RoleGuard)
  async getDetails(
    @Param('id') id: string
  ): Promise<DataResponse<Partial<UserDto>>> {
    const user = await this.userService.findById(id);
    return DataResponse.ok(new UserDto(user).toResponse(true));
  }

  @Delete('/:id')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @UseGuards(RoleGuard)
  async deleteUser(
    @Param('id') userId: string,
    @CurrentUser() currentUser: AuthUserDto,
    @IpAddress() ip: string
  ): Promise<DataResponse<{ deleted: boolean }>> {
    const result = await this.userService.delete(userId, currentUser._id, 'Admin deletion via admin panel', ip);
    return DataResponse.ok(result);
  }
}
