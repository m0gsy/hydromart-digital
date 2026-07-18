import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, AuthenticatedUser, Roles } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { DisputeService } from '../application/services/dispute.service';
import { OrderDispute } from '../domain/order-dispute';
import { CreateDisputeDto, ListDisputeQueryDto, ResolveDisputeDto } from './dto/dispute.dto';

/** Customer order disputes inbox (depot CRM). */
@ApiTags('Order Disputes')
@ApiBearerAuth()
@Roles(...CAPABILITIES.depotCrm)
@Controller({ path: 'order-disputes', version: '1' })
export class DisputeController {
  constructor(private readonly disputes: DisputeService) {}

  @Post()
  @ApiOperation({ summary: 'Raise an order dispute' })
  raise(@Body() dto: CreateDisputeDto, @CurrentUser() user: AuthenticatedUser): Promise<OrderDispute> {
    return this.disputes.raise(
      {
        depotId: dto.depotId,
        orderRef: dto.orderRef,
        customerName: dto.customerName,
        category: dto.category,
        description: dto.description,
        amountIdr: dto.amountIdr,
        courierName: dto.courierName ?? null,
      },
      user.sub,
    );
  }

  @Get()
  @ApiOperation({ summary: "List a depot's order disputes (newest first), optional status filter" })
  list(@Query() query: ListDisputeQueryDto): Promise<OrderDispute[]> {
    return this.disputes.list(query.depotId, query.status);
  }

  @Patch(':id/resolve')
  @ApiOperation({ summary: 'Resolve a dispute (refund / resend / reject)' })
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveDisputeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrderDispute> {
    return this.disputes.resolve(id, dto.resolution, dto.resolutionNote ?? null, user.sub);
  }
}
