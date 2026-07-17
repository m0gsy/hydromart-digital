import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { SupplierService } from '../application/services/supplier.service';
import { Supplier } from '../domain/supplier';
import { CreateSupplierDto, SupplierQueryDto } from './dto/procurement.dto';

/** Depot supplier directory (design 11b). */
@ApiTags('Procurement')
@ApiBearerAuth()
@Roles(...CAPABILITIES.procurement)
@Controller({ path: 'suppliers', version: '1' })
export class SupplierController {
  constructor(private readonly suppliers: SupplierService) {}

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

  @Get()
  @ApiOperation({ summary: "List a depot's suppliers (newest first)" })
  list(@Query() query: SupplierQueryDto): Promise<Supplier[]> {
    return this.suppliers.list(query.depotId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one supplier' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Supplier> {
    return this.suppliers.get(id);
  }
}
