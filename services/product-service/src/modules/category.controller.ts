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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public, Role, Roles } from '@hydromart/platform';

import { CategoryService } from '../application/services/category.service';
import { CategoryRecord } from '../application/ports/category.repository';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

const ADMIN_ROLES = [Role.DEPOT_MANAGER, Role.SUPER_ADMIN] as const;

@ApiTags('Categories')
@Controller({ path: 'categories', version: '1' })
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List active categories' })
  list(): Promise<CategoryRecord[]> {
    return this.categories.list(true);
  }

  @ApiBearerAuth()
  @Roles(...ADMIN_ROLES)
  @Post()
  @ApiOperation({ summary: 'Create a category (admin)' })
  create(@Body() dto: CreateCategoryDto): Promise<CategoryRecord> {
    return this.categories.create({ name: dto.name, slug: dto.slug, sortOrder: dto.sortOrder ?? 0 });
  }

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

  @ApiBearerAuth()
  @Roles(...ADMIN_ROLES)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a category (soft delete, admin)' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<CategoryRecord> {
    return this.categories.deactivate(id);
  }
}
