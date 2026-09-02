import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { Can, InternalAuthGuard, Public } from '@hydromart/platform';

import { SweepService } from '../application/services/sweep.service';
import { RecordSweepRunDto, SweepStatusDto } from './dto/sweep.dto';

/**
 * CA-5-01 — the seventeen scheduled sweeps, and somebody watching them.
 *
 * `scripts/check-scheduler-routes.mjs` already proves a sweep CAN run. Nothing proved one
 * still IS running: `sweep.sh` wrote its outcome into empty marker files inside the
 * scheduler container, and the container healthcheck read exactly one of them
 * (`last-success`) as a single yes/no for all seventeen jobs at once. A job that had never
 * run once was therefore indistinguishable from one that ran a minute ago, as long as some
 * OTHER job had recently succeeded.
 */
@ApiTags('ops')
@Controller({ path: 'sweeps', version: '1' })
export class SweepController {
  constructor(private readonly sweeps: SweepService) {}

  /**
   * The heartbeat, written by the scheduler sidecar.
   *
   * Internal key, not a bearer: crond holds no token, which is the same reason every sweep
   * route it calls is behind `InternalAuthGuard` (PAR-01/PAR-05).
   */
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/record')
  @ApiOperation({ summary: 'Record one scheduled sweep run (internal service auth)' })
  @ApiOkResponse({ type: SweepStatusDto })
  async record(@Body() dto: RecordSweepRunDto): Promise<{ job: string }> {
    const saved = await this.sweeps.record({
      job: dto.job,
      host: dto.host,
      ok: dto.ok,
      detail: dto.detail ?? null,
      at: new Date(),
    });
    return { job: saved.job };
  }

  /**
   * `hqBackOffice`, because that is the capability that opens /hq/health — the screen this
   * serves. `check-console-gates.mjs` fails CI if the rail's `cap` and the server's check
   * ever drift apart, which is how three screens shipped looking enforced and were not.
   */
  @ApiBearerAuth()
  @Get()
  @Can('hqBackOffice')
  @ApiOperation({ summary: 'Every scheduled sweep and how it is doing' })
  @ApiOkResponse({ type: SweepStatusDto, isArray: true })
  async list(): Promise<SweepStatusDto[]> {
    return (await this.sweeps.list()).map(SweepStatusDto.from);
  }
}
