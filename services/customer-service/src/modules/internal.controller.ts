import { Controller, Get, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { DepotCrmService } from '../application/services/depot-crm.service';

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
  constructor(private readonly crm: DepotCrmService) {}

  @Get('internal/by-depot')
  @ApiOperation({ summary: 'List customerIds whose favourite depot is the given depot (internal)' })
  async customerIdsByDepot(
    @Query('depotId', ParseUUIDPipe) depotId: string,
  ): Promise<{ customerIds: string[] }> {
    return { customerIds: await this.crm.listCustomerIdsByDepot(depotId) };
  }
}
