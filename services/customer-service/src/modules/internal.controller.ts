import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { PdpRepository } from '../application/ports/pdp.repository';
import { CUSTOMER_TOKENS } from '../application/tokens';
import { CrmDashboard, DepotCrmService } from '../application/services/depot-crm.service';
import { PdpCustomerDto } from './dto/pdp.dto';
import { CrmDashboardResponseDto, CustomerIdsByDepot2ResponseDto } from './dto/responses.generated.dto';

/**
 * Service-to-service reads (no end-user token). @Public() bypasses the global JWT guard;
 * InternalAuthGuard (shared INTERNAL_SERVICE_KEY, x-internal-key) is then the sole, fail-closed auth.
 */
@ApiTags('Internal')
@Public()
@UseGuards(InternalAuthGuard)
@ApiSecurity('internal-key')
@Controller({ path: 'customers', version: '1' })
export class InternalController {
  constructor(
    private readonly crm: DepotCrmService,
    @Inject(CUSTOMER_TOKENS.PdpRepository) private readonly pdp: PdpRepository,
  ) {}

  /**
   * UU PDP tahap 1 (item 13). auth-service owns the request queue and calls these two
   * after HEAD OFFICE approves — they are not reachable with a customer's own token,
   * because nothing here should run without that decision.
   */
  @Get('internal/pdp-export')
  @ApiOperation({ summary: 'Everything customer-service holds for a customer (internal)' })
  pdpExport(
    @Query('customerId', ParseUUIDPipe) customerId: string,
  ): Promise<Record<string, unknown>> {
    return this.pdp.exportFor(customerId);
  }

  @ApiOkResponse({ description: 'No content.' })
  @Post('internal/pdp-anonymise')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Strip profile and address PII for a deleted customer (internal, idempotent)',
  })
  pdpAnonymise(@Body() dto: PdpCustomerDto): Promise<void> {
    return this.pdp.anonymise(dto.customerId);
  }

  @ApiOkResponse({ type: CustomerIdsByDepot2ResponseDto })
  @Get('internal/by-depot')
  @ApiOperation({ summary: 'List customerIds whose favourite depot is the given depot (internal)' })
  async customerIdsByDepot(
    @Query('depotId', ParseUUIDPipe) depotId: string,
  ): Promise<{ customerIds: string[] }> {
    return { customerIds: await this.crm.listCustomerIdsByDepot(depotId) };
  }

  // dashboard-service pulls per-depot CRM segments + follow-up count for the owner
  // franchise dashboard (Fase 5). Same CRM lifecycle math as the bearer-gated dashboard.
  @ApiOkResponse({ type: CrmDashboardResponseDto })
  @Get('internal/crm-summary')
  @ApiOperation({ summary: 'Per-depot CRM lifecycle summary (internal service auth)' })
  crmSummary(@Query('depotId', ParseUUIDPipe) depotId: string): Promise<CrmDashboard> {
    return this.crm.getCrmDashboard(depotId);
  }
}
