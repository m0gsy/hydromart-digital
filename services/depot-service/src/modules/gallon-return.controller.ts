import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, AuthenticatedUser, Roles, assertDepotOwnership } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { GallonReturnService } from '../application/services/gallon-return.service';
import { DepotService } from '../application/services/depot.service';
import { GallonReturnRecord, GallonReturnSummary } from '../application/ports/gallon-return.repository';
import { Page } from '../application/pagination';
import { CreateGallonReturnDto, ListReturnsQueryDto } from './dto/gallon-return.dto';

/** Empty-gallon returns / deposit refunds nested under a depot (PRD Module 11). */
@ApiTags('Gallon returns')
@ApiBearerAuth()
@Controller({ path: 'depots/:depotId/returns', version: '1' })
export class GallonReturnController {
  constructor(
    private readonly returns: GallonReturnService,
    private readonly depots: DepotService,
  ) {}

  @Roles(...CAPABILITIES.returnsWrite)
  @Post()
  @ApiOperation({ summary: 'Record an empty-gallon return (staff)' })
  record(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: CreateGallonReturnDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<GallonReturnRecord> {
    return this.returns.record(
      depotId,
      {
        customerId: dto.customerId ?? null,
        quantity: dto.quantity,
        condition: dto.condition,
        depositRefunded: dto.depositRefunded,
        note: dto.note ?? null,
      },
      user.sub,
    );
  }

  // Static `summary` segment declared before the paginated list so the route is unambiguous.
  @Roles(...CAPABILITIES.returnsRead)
  @Get('summary')
  @ApiOperation({ summary: "A depot's return totals (count, gallons, deposit refunded)" })
  async summary(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<GallonReturnSummary> {
    assertDepotOwnership(user, (await this.depots.get(depotId, false)).ownerId);
    return this.returns.summary(depotId);
  }

  @Roles(...CAPABILITIES.returnsRead)
  @Get()
  @ApiOperation({ summary: "List a depot's gallon returns (paginated, newest first)" })
  async list(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Query() query: ListReturnsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Page<GallonReturnRecord>> {
    assertDepotOwnership(user, (await this.depots.get(depotId, false)).ownerId);
    return this.returns.list(depotId, query.page ?? 1, query.limit ?? 20);
  }
}
