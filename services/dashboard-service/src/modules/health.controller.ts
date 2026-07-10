import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '@hydromart/platform';

@ApiTags('Health')
@Controller()
export class HealthController {
  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Service liveness' })
  check() {
    return {
      status: 'ok',
      service: 'dashboard-service',
      timestamp: new Date().toISOString(),
    };
  }
}
