import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';

import { Public } from '@hydromart/platform';

export class HealthResponseDto {
  @ApiProperty({ example: 'ok' })
  status!: string;
  @ApiProperty({ example: 'face-service' })
  service!: string;
  @ApiProperty()
  timestamp!: string;
}

/**
 * Healthy means ready: the app only starts listening after both models loaded, matched
 * their pinned hashes and ran a self-check (see app.module's FACE_ENGINE factory).
 */
@ApiTags('Health')
@Controller()
export class HealthController {
  // route-authz: public by construction — liveness for the compose healthcheck and the
  // probes, the same answer for everyone and nothing about any person or image in it.
  @ApiOkResponse({ type: HealthResponseDto })
  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Service liveness (models loaded and self-checked)' })
  check(): HealthResponseDto {
    return { status: 'ok', service: 'face-service', timestamp: new Date().toISOString() };
  }
}
