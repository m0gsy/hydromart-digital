import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { SlaAlertService, SlaSweepResult } from '../application/services/sla-alert.service';
import { SlaSweepResponseDto } from './dto/responses.generated.dto';

/**
 * J8. The scheduler's end of the SLA alert. Not a JWT route — @Public() bypasses the
 * global JWT guard and InternalAuthGuard (x-internal-key) is the sole, fail-closed auth,
 * same as the retention sweep beside it.
 */
@ApiTags('Delivery SLA (internal)')
@Controller({ path: 'deliveries', version: '1' })
export class SlaAlertController {
  constructor(private readonly sla: SlaAlertService) {}

  @ApiOkResponse({ type: SlaSweepResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/sla-sweep')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Alert ops about deliveries past their depot SLA (internal, scheduler)',
    description:
      'Reports, it does not reassign. `ok` is false when breaches were found and none of ' +
      'the alerts reached ops — the scheduler must not read that as a quiet round.',
  })
  sweep(): Promise<SlaSweepResult> {
    return this.sla.sweep();
  }
}
