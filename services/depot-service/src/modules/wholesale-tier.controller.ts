import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, CurrentUser, AuthenticatedUser, assertDepotAccess } from '@hydromart/platform';

import { WholesaleTierService } from '../application/services/wholesale-tier.service';
import { WholesaleTier } from '../domain/wholesale-tier';
import {
  CreateWholesaleTierDto,
  UpdateWholesaleTierDto,
  WholesaleTierQueryDto,
} from './dto/wholesale-tier.dto';
import { RemoveResponseDto, WholesaleTierResponseDto } from './dto/responses.generated.dto';

/** Depot wholesale pricing tiers (design 16b). */
@ApiTags('Wholesale Tiers')
@ApiBearerAuth()
@Can('depotWholesale')
@Controller({ path: 'wholesale-tiers', version: '1' })
export class WholesaleTierController {
  constructor(private readonly tiers: WholesaleTierService) {}

  @ApiOkResponse({ type: WholesaleTierResponseDto, isArray: true })
  @Get()
  @ApiOperation({ summary: "List a depot's wholesale tiers (by minQty ascending)" })
  list(@Query() query: WholesaleTierQueryDto): Promise<WholesaleTier[]> {
    return this.tiers.list(query.depotId);
  }

  @ApiOkResponse({ type: WholesaleTierResponseDto })
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

  @ApiOkResponse({ type: WholesaleTierResponseDto })
  @Patch(':id')
  @ApiOperation({ summary: 'Update a wholesale tier' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWholesaleTierDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WholesaleTier> {
    assertDepotAccess(user, (await this.tiers.get(id)).depotId);
    // `seenUpdatedAt` is the version the client read, a token for the freshness check and not a column:
    // it has to stop here. Forwarded with the rest of the patch it reached Prisma as an unknown field
    // ("Unknown argument `seenUpdatedAt`") and the save answered 500 — for every console form that
    // sends the stamp, which is what CA-2-53 made them all do.
    const { seenUpdatedAt, ...patch } = dto;
    return this.tiers.update(id, patch, seenUpdatedAt);
  }

  @ApiOkResponse({ type: RemoveResponseDto })
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
