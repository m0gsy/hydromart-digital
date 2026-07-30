import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public, rbacHealth } from '@hydromart/platform';

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
      checks: { ...rbacHealth() },
      timestamp: new Date().toISOString(),
    };
  }
}
