import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, AuthenticatedUser, Roles, assertDepotAccess } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { WholesaleTierService } from '../application/services/wholesale-tier.service';
import { WholesaleTier } from '../domain/wholesale-tier';
import {
  CreateWholesaleTierDto,
  UpdateWholesaleTierDto,
  WholesaleTierQueryDto,
} from './dto/wholesale-tier.dto';

/** Depot wholesale pricing tiers (design 16b). */
@ApiTags('Wholesale Tiers')
@ApiBearerAuth()
@Roles(...CAPABILITIES.depotAdmin)
@Controller({ path: 'wholesale-tiers', version: '1' })
export class WholesaleTierController {
  constructor(private readonly tiers: WholesaleTierService) {}

  @Get()
  @ApiOperation({ summary: "List a depot's wholesale tiers (by minQty ascending)" })
  list(@Query() query: WholesaleTierQueryDto): Promise<WholesaleTier[]> {
    return this.tiers.list(query.depotId);
  }

  @Post()
  @ApiOperation({ summary: 'Add a wholesale tier to a depot' })
  create(@Body() dto: CreateWholesaleTierDto): Promise<WholesaleTier> {
    return this.tiers.create({
      depotId: dto.depotId,
      productId: dto.productId ?? null,
      label: dto.label,
      minQty: dto.minQty,
      maxQty: dto.maxQty ?? null,
      priceIdr: dto.priceIdr,
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a wholesale tier' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWholesaleTierDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WholesaleTier> {
    assertDepotAccess(user, (await this.tiers.get(id)).depotId);
    return this.tiers.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a wholesale tier' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    assertDepotAccess(user, (await this.tiers.get(id)).depotId);
    await this.tiers.remove(id);
    return { deleted: true };
  }
}
