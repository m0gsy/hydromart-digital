import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import {
  Can,
  CurrentUser,
  AuthenticatedUser,
  assertDepotAccess,
  InternalAuthGuard,
  Public,
} from '@hydromart/platform';

import { DisputeService } from '../application/services/dispute.service';
import { OrderDispute } from '../domain/order-dispute';
import {
  CreateDisputeDto,
  ListDisputeQueryDto,
  PdpAnonymiseDto,
  PdpErasedResponseDto,
  ResolveDisputeDto,
} from './dto/dispute.dto';
import { OrderDisputeResponseDto } from './dto/responses.generated.dto';

/** Customer order disputes inbox (depot CRM). */
@ApiTags('Order Disputes')
@ApiBearerAuth()
@Can('depotDisputes')
@Controller({ path: 'order-disputes', version: '1' })
export class DisputeController {
  constructor(private readonly disputes: DisputeService) {}

  /**
   * DPT-2: the erasure fan-out auth-service drives, same internal-key shape as every other
   * service's. Internal key rather than a bearer: the caller is auth-service, not a person.
   */
  @ApiOkResponse({ type: PdpErasedResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/pdp-anonymise')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Erase one person from depot disputes, incidents and subscriptions' })
  pdpAnonymise(@Body() dto: PdpAnonymiseDto): Promise<{ erased: number }> {
    return this.disputes.erasePerson(dto.customerId, dto.phone ?? null);
  }

  @ApiOkResponse({ type: OrderDisputeResponseDto })
  @Post()
  @ApiOperation({ summary: 'Raise an order dispute' })
  raise(
    @Body() dto: CreateDisputeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrderDispute> {
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

  @ApiOkResponse({ type: OrderDisputeResponseDto, isArray: true })
  @Get()
  @ApiOperation({ summary: "List a depot's order disputes (newest first), optional status filter" })
  list(@Query() query: ListDisputeQueryDto): Promise<OrderDispute[]> {
    return this.disputes.list(query.depotId, query.status);
  }

  @ApiOkResponse({ type: OrderDisputeResponseDto })
  @Patch(':id/resolve')
  @ApiOperation({ summary: 'Resolve a dispute (refund / resend / reject)' })
  async resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveDisputeDto,
    @CurrentUser() user: AuthenticatedUser,
    // CA-2-39: the manager's own bearer rides along, so `Can('refundIssue')` applies to
    // them and the refund is attributed to them rather than to a service key.
    @Headers('authorization') authorization = '',
  ): Promise<OrderDispute> {
    assertDepotAccess(user, (await this.disputes.get(id)).depotId);
    return this.disputes.resolve(
      id,
      dto.resolution,
      dto.resolutionNote ?? null,
      user.sub,
      authorization,
    );
  }
}
