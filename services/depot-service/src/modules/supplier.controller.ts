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

import { Can, CurrentUser, AuthenticatedUser, assertDepotAccess } from '@hydromart/platform';

import { SupplierService } from '../application/services/supplier.service';
import { Supplier } from '../domain/supplier';
import { CreateSupplierDto, SupplierQueryDto, UpdateSupplierDto } from './dto/procurement.dto';
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

  /*
   * CA-2-64: the directory was create-and-forget. A phone number typed wrong, a name
   * spelled wrong, a vendor that changed hands — all permanent, and the only workaround
   * was a second row for the same supplier, which split its purchase history in two.
   */
  @ApiOkResponse({ type: SupplierResponseDto })
  @Patch(':id')
  @ApiOperation({ summary: "Correct a supplier's details" })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Supplier> {
    assertDepotAccess(user, (await this.suppliers.get(id)).depotId);
    return this.suppliers.update(id, dto);
  }

  /*
   * Only a supplier no purchase order names. A PO snapshots `supplierName`, so its history
   * reads fine either way — but its `supplierId` would dangle, and creating a PO refuses a
   * missing supplier. A vendor with orders against it is corrected, never deleted.
   */
  @ApiOkResponse({ description: 'No content.' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a supplier that no purchase order references' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    assertDepotAccess(user, (await this.suppliers.get(id)).depotId);
    await this.suppliers.remove(id);
  }
}
