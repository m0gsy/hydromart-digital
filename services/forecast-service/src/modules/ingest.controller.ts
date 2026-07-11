import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { ForecastService } from '../application/services/forecast.service';
import { IngestDto } from './dto/forecast.dto';

// Fired by order-service when an order completes. Authenticated by the shared
// INTERNAL_SERVICE_KEY, not a JWT — @Public() bypasses the global JWT guard;
// InternalAuthGuard is then the sole (fail-closed) auth.
@ApiTags('forecast')
@Controller({ path: 'forecast', version: '1' })
export class IngestController {
  constructor(private readonly forecasts: ForecastService) {}

  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('ingest')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ingest a completed order into the forecast read model (internal, idempotent)' })
  async ingest(@Body() dto: IngestDto): Promise<{ ingested: true }> {
    // Live ingest: completion time ≈ now. (Rebuild passes historical `at` via the feed adapter.)
    await this.forecasts.ingest({
      orderId: dto.orderId,
      depotId: dto.depotId ?? null,
      items: dto.items,
      at: new Date(),
    });
    return { ingested: true };
  }
}
