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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public, Role, Roles } from '@hydromart/platform';

import { ProductService } from '../application/services/product.service';
import { ProductRecord } from '../application/ports/product.repository';
import { Page } from '../application/pagination';
import { BrowseProductsQueryDto, CreateProductDto, UpdateProductDto } from './dto/product.dto';

const ADMIN_ROLES = [Role.DEPOT_MANAGER, Role.SUPER_ADMIN] as const;

@ApiTags('Products')
@Controller({ path: 'products', version: '1' })
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Browse the catalog (paginated, active products only)' })
  browse(@Query() query: BrowseProductsQueryDto): Promise<Page<ProductRecord>> {
    return this.products.browse(query, true);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get an active product by id' })
  @ApiOkResponse()
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ProductRecord> {
    return this.products.get(id, true);
  }

  @ApiBearerAuth()
  @Roles(...ADMIN_ROLES)
  @Post()
  @ApiOperation({ summary: 'Create a product (admin)' })
  create(@Body() dto: CreateProductDto): Promise<ProductRecord> {
    return this.products.create({
      categoryId: dto.categoryId ?? null,
      name: dto.name,
      sku: dto.sku,
      description: dto.description ?? null,
      unit: dto.unit,
      basePrice: dto.basePrice,
      imageUrl: dto.imageUrl ?? null,
    });
  }

  @ApiBearerAuth()
  @Roles(...ADMIN_ROLES)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a product (admin)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductRecord> {
    return this.products.update(id, dto);
  }

  @ApiBearerAuth()
  @Roles(...ADMIN_ROLES)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a product (soft delete, admin)' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<ProductRecord> {
    return this.products.deactivate(id);
  }
}
