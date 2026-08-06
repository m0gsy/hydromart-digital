import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public, Role, Roles } from '@hydromart/platform';

import { CategoryService } from '../application/services/category.service';
import { CategoryRecord } from '../application/ports/category.repository';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { CategoryResponseDto } from './dto/responses.generated.dto';

const ADMIN_ROLES = [Role.MANAGER, Role.SUPER_ADMIN] as const;

@ApiTags('Categories')
@Controller({ path: 'categories', version: '1' })
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  @ApiOkResponse({ type: CategoryResponseDto, isArray: true })
  @Public()
  @Get()
  @ApiOperation({ summary: 'List active categories' })
  list(): Promise<CategoryRecord[]> {
    return this.categories.list(true);
  }

  // Deactivated categories are invisible on the public list by design, which left the
  // console unable to bring one back. Admins get the unfiltered set on their own route
  // rather than a flag on the public one — nothing extra leaks to the shop.
  @ApiOkResponse({ type: CategoryResponseDto, isArray: true })
  @ApiBearerAuth()
  @Roles(...ADMIN_ROLES)
  @Get('all')
  @ApiOperation({ summary: 'List every category, active or not (admin)' })
  listAll(): Promise<CategoryRecord[]> {
    return this.categories.list(false);
  }

  @ApiOkResponse({ type: CategoryResponseDto })
  @ApiBearerAuth()
  @Roles(...ADMIN_ROLES)
  @Post()
  @ApiOperation({ summary: 'Create a category (admin)' })
  create(@Body() dto: CreateCategoryDto): Promise<CategoryRecord> {
    return this.categories.create({ name: dto.name, slug: dto.slug, sortOrder: dto.sortOrder ?? 0 });
  }

  @ApiOkResponse({ type: CategoryResponseDto })
  @ApiBearerAuth()
  @Roles(...ADMIN_ROLES)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a category (admin)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryRecord> {
    return this.categories.update(id, dto);
  }

  @ApiOkResponse({ type: CategoryResponseDto })
  @ApiBearerAuth()
  @Roles(...ADMIN_ROLES)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a category (soft delete, admin)' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<CategoryRecord> {
    return this.categories.deactivate(id);
  }
}
