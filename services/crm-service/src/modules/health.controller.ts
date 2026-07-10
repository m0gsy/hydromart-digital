import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '@hydromart/platform';

import { PrismaService } from '../infrastructure/prisma/prisma.service';

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Service liveness and database readiness' })
  async check() {
    let database: 'up' | 'down' = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }
    const status = {
      status: database === 'up' ? 'ok' : 'error',
      service: 'crm-service',
      checks: { database },
      timestamp: new Date().toISOString(),
    };
    if (status.status === 'error') {
      throw new ServiceUnavailableException(status);
    }
    return status;
  }
}
