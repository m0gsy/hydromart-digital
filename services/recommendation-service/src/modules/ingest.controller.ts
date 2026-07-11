import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { RecommendationService } from '../application/services/recommendation.service';
import { IngestOrderDto } from './dto/recommendation.dto';

// Fired by order-service when an order completes. Authenticated by the shared
// INTERNAL_SERVICE_KEY, not a JWT — @Public() bypasses the global JWT guard;
// InternalAuthGuard is then the sole (fail-closed) auth.
@ApiTags('Recommendations (internal)')
@Controller({ path: 'recommendations', version: '1' })
export class IngestController {
  constructor(private readonly recommendations: RecommendationService) {}

  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('ingest')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ingest a completed order into the recommendation read model (internal, idempotent)' })
  async ingest(@Body() dto: IngestOrderDto): Promise<{ ingested: true }> {
    await this.recommendations.ingest({
      orderId: dto.orderId,
      customerId: dto.customerId,
      depotId: dto.depotId ?? null,
      items: dto.items,
      at: new Date(),
    });
    return { ingested: true };
  }
}
