import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Role, Roles } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { PriceOverrideService } from '../application/services/price-override.service';
import {
  PriceOverrideProposalRecord,
  PriceOverrideStatus,
} from '../domain/price-override-proposal';
import { Page } from '../application/pagination';
import { ListPriceOverridesQueryDto, ProposePriceOverrideDto } from './dto/price-override.dto';

/**
 * Depot-side propose (design 7a): a depot manager proposes a per-product price
 * override for their depot. Gated on depotAdmin (DEPOT_MANAGER + SUPER_ADMIN).
 */
@ApiTags('Price overrides')
@ApiBearerAuth()
@Controller({ path: 'depots/:depotId/price-overrides', version: '1' })
export class DepotPriceOverrideController {
  constructor(private readonly overrides: PriceOverrideService) {}

  @Post()
  @Roles(...CAPABILITIES.depotAdmin)
  @ApiOperation({ summary: 'Propose a per-product price override for a depot (depot manager)' })
  propose(
    @CurrentUser() user: AuthenticatedUser,
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: ProposePriceOverrideDto,
  ): Promise<PriceOverrideProposalRecord> {
    return this.overrides.propose(depotId, user.sub, {
      productId: dto.productId,
      productName: dto.productName,
      currentPrice: dto.currentPrice,
      adjustType: dto.adjustType,
      value: dto.value,
      note: dto.note ?? null,
    });
  }
}

/**
 * HQ price-override approvals queue (design 7a right panel). HQ-only: HEAD_OFFICE +
 * SUPER_ADMIN. Lists the pending queue by default and decides each proposal.
 */
@ApiTags('Price overrides')
@ApiBearerAuth()
@Roles(Role.HEAD_OFFICE, Role.SUPER_ADMIN)
@Controller({ path: 'price-overrides', version: '1' })
export class PriceOverrideController {
  constructor(private readonly overrides: PriceOverrideService) {}

  @Get()
  @ApiOperation({ summary: 'List override proposals (defaults to the pending queue)' })
  list(
    @Query() query: ListPriceOverridesQueryDto,
  ): Promise<Page<PriceOverrideProposalRecord>> {
    return this.overrides.list({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      status: query.status ?? PriceOverrideStatus.PENDING,
    });
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve → applies the override as a winning pricing rule' })
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PriceOverrideProposalRecord> {
    return this.overrides.approve(id, user.sub);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject an override proposal (no price change)' })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PriceOverrideProposalRecord> {
    return this.overrides.reject(id, user.sub);
  }
}
