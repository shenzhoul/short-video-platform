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
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags
} from '@nestjs/swagger';
import { Roles } from 'src/common/decorators';
import { PaginationGuard, RoleGuard } from 'src/common/guards';
import { CategoryDto } from 'src/dtos/content/category';
import { DataResponse } from 'src/kernel';
import { PageableData } from 'src/kernel/common';
import {
  CategoryCreatePayload,
  CategorySearchRequest,
  CategoryUpdatePayload
} from 'src/payloads/content/category';
import { CategoryService } from 'src/services/content/category';

/**
 * Admin management of the post category catalogue.
 *
 * The catalogue is what the composer's topic picker and the home category bar are built from, so
 * everything here is admin-only.
 */
@Injectable()
@Controller('admin/categories')
@ApiTags('Admin Categories')
@ApiSecurity('token-auth')
export class AdminCategoryController {
  constructor(private readonly categoryService: CategoryService) { }

  @Get('/search')
  @Roles('admin')
  @UseGuards(RoleGuard, PaginationGuard)
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Search post categories',
    description: 'Lists categories with keyword and status filters. Sorted by display order by default.'
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Categories retrieved successfully' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Admin role required' })
  async search(
    @Query() req: CategorySearchRequest
  ): Promise<DataResponse<PageableData<CategoryDto>>> {
    const result = await this.categoryService.search(req);
    return DataResponse.ok({
      ...result,
      data: result.data.map((item) => item.toAdminResponse())
    } as any);
  }

  @Get('/:id')
  @Roles('admin')
  @UseGuards(RoleGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get one post category',
    description: 'Accepts either the category id or its stable key.'
  })
  @ApiParam({ name: 'id', description: 'Category id or key' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Category retrieved successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Category not found' })
  async view(@Param('id') id: string): Promise<DataResponse<any>> {
    const category = await this.categoryService.findByIdOrKey(id);
    return DataResponse.ok(category.toAdminResponse());
  }

  @Post('')
  @Roles('admin')
  @UseGuards(RoleGuard)
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Create a post category',
    description: 'The key is supplied by the admin and is immutable afterwards, because every post filed under this category stores it.'
  })
  @ApiBody({ type: CategoryCreatePayload })
  @ApiResponse({ status: HttpStatus.OK, description: 'Category created successfully' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'A category with this key already exists' })
  async create(@Body() payload: CategoryCreatePayload): Promise<DataResponse<any>> {
    const category = await this.categoryService.create(payload);
    return DataResponse.ok(category.toAdminResponse());
  }

  @Put('/:id')
  @Roles('admin')
  @UseGuards(RoleGuard)
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Update a post category',
    description: 'Updates name, description, status and display order. The key cannot be changed.'
  })
  @ApiParam({ name: 'id', description: 'Category id' })
  @ApiBody({ type: CategoryUpdatePayload })
  @ApiResponse({ status: HttpStatus.OK, description: 'Category updated successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Category not found' })
  async update(
    @Param('id') id: string,
    @Body() payload: CategoryUpdatePayload
  ): Promise<DataResponse<any>> {
    const category = await this.categoryService.update(id, payload);
    return DataResponse.ok(category.toAdminResponse());
  }

  @Delete('/:id')
  @Roles('admin')
  @UseGuards(RoleGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Disable a post category',
    description: 'Sets the category to inactive. The record is never removed, so posts already filed under it keep a valid category key.'
  })
  @ApiParam({ name: 'id', description: 'Category id' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Category disabled successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Category not found' })
  async disable(@Param('id') id: string): Promise<DataResponse<any>> {
    const category = await this.categoryService.disable(id);
    return DataResponse.ok(category.toAdminResponse());
  }
}
