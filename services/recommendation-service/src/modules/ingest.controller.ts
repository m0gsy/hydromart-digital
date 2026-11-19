import { Body, Controller, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { RecommendationService } from '../application/services/recommendation.service';
import { RebuildService } from '../application/services/rebuild.service';
import { IngestOrderDto, RebuildQueryDto } from './dto/recommendation.dto';
import { BackfillLastQuantityResponseDto, Ingest3ResponseDto } from './dto/responses.generated.dto';

// Fired by order-service when an order completes. Authenticated by the shared
// INTERNAL_SERVICE_KEY, not a JWT — @Public() bypasses the global JWT guard;
// InternalAuthGuard is then the sole (fail-closed) auth.
@ApiTags('Recommendations (internal)')
@Controller({ path: 'recommendations', version: '1' })
export class IngestController {
  constructor(
    private readonly recommendations: RecommendationService,
    private readonly rebuild: RebuildService,
  ) {}

  /**
   * Owner decision 2026-11-19: fill "Beli lagi"'s quantity for purchases recorded before the
   * column existed. Internal (service key), so it can be run from the box once. Idempotent:
   * it writes only rows still empty.
   */
  @ApiOkResponse({ type: BackfillLastQuantityResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/backfill/last-quantity')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fill lastQuantity on purchases recorded before it existed (internal, idempotent)' })
  backfillLastQuantity(@Query() query: RebuildQueryDto): Promise<{ orders: number; rows: number }> {
    return this.rebuild.backfillLastQuantity(query.limit ?? 100);
  }

  @ApiOkResponse({ type: Ingest3ResponseDto })
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
