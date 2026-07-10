import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

interface HealthStatus {
  status: 'ok' | 'error';
  service: string;
  checks: { database: 'up' | 'down' };
  timestamp: string;
}

/** Liveness/readiness probe for orchestration (Cloud Run / load balancer). */
@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Service liveness and database readiness' })
  async check(): Promise<HealthStatus> {
    let database: 'up' | 'down' = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }

    const status: HealthStatus = {
      status: database === 'up' ? 'ok' : 'error',
      service: 'auth-service',
      checks: { database },
      timestamp: new Date().toISOString(),
    };

    if (status.status === 'error') {
      throw new ServiceUnavailableException(status);
    }
    return status;
  }
}
