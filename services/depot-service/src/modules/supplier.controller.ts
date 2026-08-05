import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, CurrentUser, AuthenticatedUser, assertDepotAccess } from '@hydromart/platform';

import { SupplierService } from '../application/services/supplier.service';
import { Supplier } from '../domain/supplier';
import { CreateSupplierDto, SupplierQueryDto } from './dto/procurement.dto';
import { SupplierResponseDto } from './dto/responses.generated.dto';

/** Depot supplier directory (design 11b). */
@ApiTags('Procurement')
@ApiBearerAuth()
@Can('procurement')
@Controller({ path: 'suppliers', version: '1' })
export class SupplierController {
  constructor(private readonly suppliers: SupplierService) {}

  @ApiOkResponse({ type: SupplierResponseDto })
  @Post()
  @ApiOperation({ summary: 'Add a supplier to a depot directory' })
  create(@Body() dto: CreateSupplierDto): Promise<Supplier> {
    return this.suppliers.create({
      depotId: dto.depotId,
      name: dto.name,
      code: dto.code,
      contactPhone: dto.contactPhone ?? null,
      categories: dto.categories ?? [],
      onTimeRate: dto.onTimeRate ?? null,
    });
  }

  @ApiOkResponse({ type: SupplierResponseDto, isArray: true })
  @Get()
  @ApiOperation({ summary: "List a depot's suppliers (newest first)" })
  list(@Query() query: SupplierQueryDto): Promise<Supplier[]> {
    return this.suppliers.list(query.depotId);
  }

  @ApiOkResponse({ type: SupplierResponseDto })
  @Get(':id')
  @ApiOperation({ summary: 'Get one supplier' })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Supplier> {
    const supplier = await this.suppliers.get(id);
    assertDepotAccess(user, supplier.depotId);
    return supplier;
  }
}
