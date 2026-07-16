import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { DeliveryService } from '../application/services/delivery.service';

/**
 * UU PDP retention sweep, triggered by the internal scheduler (crond → sweep.sh).
 * Not a JWT route: @Public() bypasses the global JWT guard and InternalAuthGuard
 * (x-internal-key) is the sole auth, mirroring order-service's process-due sweep.
 */
@ApiTags('Retention (internal)')
@Controller({ path: 'proofs', version: '1' })
export class RetentionController {
  constructor(private readonly deliveries: DeliveryService) {}

  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('purge-expired')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete proof-of-delivery records past the retention window (internal, UU PDP)' })
  purgeExpired(): Promise<{ purged: number }> {
    return this.deliveries.purgeExpiredProofs();
  }
}
