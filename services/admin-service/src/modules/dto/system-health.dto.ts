import { ApiProperty } from '@nestjs/swagger';

import { ServiceHealth, SystemHealth } from '../../application/services/system-health.service';

export class ServiceHealthDto {
  @ApiProperty({ example: 'auth-service' })
  name!: string;
  @ApiProperty({ enum: ['up', 'down'] })
  status!: 'up' | 'down';
  @ApiProperty({ example: 82, description: 'Probe round-trip latency (ms).' })
  latencyMs!: number;
  @ApiProperty({ nullable: true, example: 200, description: 'HTTP status; null if unreachable.' })
  httpStatus!: number | null;

  static from(s: ServiceHealth): ServiceHealthDto {
    return { name: s.name, status: s.status, latencyMs: s.latencyMs, httpStatus: s.httpStatus };
  }
}

export class SystemHealthDto {
  @ApiProperty({ type: [ServiceHealthDto] })
  services!: ServiceHealthDto[];
  @ApiProperty({ example: 14 })
  upCount!: number;
  @ApiProperty({ example: 15 })
  total!: number;
  @ApiProperty({ type: String, format: 'date-time' })
  checkedAt!: string;

  static from(h: SystemHealth): SystemHealthDto {
    return {
      services: h.services.map((s) => ServiceHealthDto.from(s)),
      upCount: h.upCount,
      total: h.total,
      checkedAt: h.checkedAt,
    };
  }
}
