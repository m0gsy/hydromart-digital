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

import { AuthenticatedUser, Can, CurrentUser, Public } from '@hydromart/platform';

import { ProductService } from '../application/services/product.service';
import { PriceChangeRecord, ProductRecord } from '../application/ports/product.repository';
import { Page } from '../application/pagination';
import { BrowseProductsQueryDto, CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { PagedProductResponseDto, ProductResponseDto } from './dto/responses.generated.dto';
import { PriceChangeResponseDto } from './dto/product.dto';


@ApiTags('Products')
@Controller({ path: 'products', version: '1' })
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @ApiOkResponse({ type: PagedProductResponseDto })
  @Public()
  @Get()
  @ApiOperation({ summary: 'Browse the catalog (paginated, active products only)' })
  browse(@Query() query: BrowseProductsQueryDto): Promise<Page<ProductRecord>> {
    return this.products.browse(query, true);
  }

  // Deactivating a product hid it from the only list the console has, so an operator
  // who unticked "aktif" could never tick it back. Admins get the unfiltered set on
  // their own route rather than a flag on the public one — nothing extra leaks to the
  // shop. Declared above `:id` so 'all' is not parsed as a product id.
  @ApiOkResponse({ type: PagedProductResponseDto })
  @ApiBearerAuth()
  @Can('catalogWrite')
  @Get('all')
  @ApiOperation({ summary: 'Browse every product, active or not (admin)' })
  browseAll(@Query() query: BrowseProductsQueryDto): Promise<Page<ProductRecord>> {
    return this.products.browse(query, false);
  }

  // The batch of the route below (audit S-7): checkout resolves every cart line at once,
  // and used to open one HTTP call per line to do it. Declared above `:id` so 'batch' is
  // not parsed as a product id. Active only, same as the single-product route; an id that
  // does not exist is simply absent from the reply rather than failing the whole call.
  @ApiOkResponse({ type: ProductResponseDto, isArray: true })
  @Public()
  @Get('batch')
  @ApiOperation({ summary: 'Get many active products by id, comma-separated' })
  batch(@Query('ids') ids: string): Promise<ProductRecord[]> {
    return this.products.byIds(
      (ids ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    );
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get an active product by id' })
  @ApiOkResponse()
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ProductRecord> {
    return this.products.get(id, true);
  }

  @ApiOkResponse({ type: ProductResponseDto })
  @ApiBearerAuth()
  @Can('catalogWrite')
  @Post()
  @ApiOperation({ summary: 'Create a product (admin)' })
  create(@Body() dto: CreateProductDto): Promise<ProductRecord> {
    return this.products.create({
      categoryId: dto.categoryId ?? null,
      name: dto.name,
      sku: dto.sku,
      description: dto.description ?? null,
      unit: dto.unit,
      volumeMl: dto.volumeMl ?? null,
      isGallon: dto.isGallon ?? false,
      basePrice: dto.basePrice,
      imageUrl: dto.imageUrl ?? null,
      images: dto.images ?? [],
    });
  }

  @ApiOkResponse({ type: ProductResponseDto })
  @ApiBearerAuth()
  @Can('catalogWrite')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a product (admin)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProductRecord> {
    // PRD-1: who moved the price travels with the write. The catalog stays editable by a
    // depot manager (owner decision 2026-09-11); what was missing is the record.
    return this.products.update(id, dto, dto.seenUpdatedAt, user.sub);
  }

  /**
   * PRD-1: what this product's base price has been, and who changed it.
   *
   * `catalogWrite`, not a read capability: the trail names staff accounts, and the people
   * who may see who changed a price are the people who may change one.
   */
  @ApiOkResponse({ type: PriceChangeResponseDto, isArray: true })
  @ApiBearerAuth()
  @Can('catalogWrite')
  @Get(':id/price-history')
  @ApiOperation({ summary: 'Recorded base-price changes for a product (admin)' })
  priceHistory(@Param('id', ParseUUIDPipe) id: string): Promise<PriceChangeRecord[]> {
    return this.products.priceHistory(id);
  }

  @ApiOkResponse({ type: ProductResponseDto })
  @ApiBearerAuth()
  @Can('catalogWrite')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a product (soft delete, admin)' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<ProductRecord> {
    return this.products.deactivate(id);
  }
}
