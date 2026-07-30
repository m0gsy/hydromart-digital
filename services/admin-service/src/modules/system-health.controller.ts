import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can } from '@hydromart/platform';

import { SystemHealthService } from '../application/services/system-health.service';
import { SystemHealthDto } from './dto/system-health.dto';

// Design 13b — aggregate system health. Head-office + super-admin oversight.
@ApiTags('System health')
@ApiBearerAuth()
@Can('hqConsole')
@Controller({ path: 'system-health', version: '1' })
export class SystemHealthController {
  constructor(private readonly health: SystemHealthService) {}

  @Get()
  @ApiOperation({ summary: 'Aggregate per-service health roll-up (real, per-service probe)' })
  async check(): Promise<SystemHealthDto> {
    return SystemHealthDto.from(await this.health.check());
  }
}
