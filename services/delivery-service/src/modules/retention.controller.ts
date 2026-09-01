import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { DeliveryService } from '../application/services/delivery.service';
import { PdpAnonymiseDto, PurgeProofsDto } from './dto/retention.dto';
import { PdpErasedResponseDto, PurgeExpired2ResponseDto } from './dto/responses.generated.dto';

/**
 * UU PDP retention sweep, driven by admin-service's purge engine.
 *
 * The cutoff is passed in rather than recomputed: the retention policy table is the one
 * place that decides how long anything is kept. Not a JWT route — @Public() bypasses the
 * global JWT guard and InternalAuthGuard (x-internal-key) is the sole, fail-closed auth.
 */
@ApiTags('Retention (internal)')
@Controller({ path: 'proofs', version: '1' })
export class RetentionController {
  constructor(private readonly deliveries: DeliveryService) {}

  @ApiOkResponse({ type: PurgeExpired2ResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('purge-expired')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete proof-of-delivery records older than the cutoff (internal, UU PDP)',
    description: 'The cutoff comes from the admin-service retention policy, not from a local setting.',
  })
  async purgeExpired(@Body() dto: PurgeProofsDto): Promise<{ purged: number; deleted: number }> {
    const { purged } = await this.deliveries.purgeProofsOlderThan(new Date(dto.cutoff));
    // `deleted` is the field every purge executor reads; `purged` is kept for the
    // original response shape so an existing caller is not broken by the rename.
    return { purged, deleted: purged };
  }

  /*
   * UU PDP item 13 — forget one person, now rather than when a window expires.
   *
   * The sweep above is a WINDOW: proofs disappear 365 days after handover, and
   * `deliveries.recipientPhone` has no window at all. `docs/AUDIT_L3.md` §4.2 counted what
   * that left: 153 phone numbers and 76 recipient names belonging to people who had asked
   * to be forgotten. A window is not an answer to "forget me today".
   */
  @ApiOkResponse({ type: PdpErasedResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/pdp-anonymise')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Scrub one person from deliveries + proofs (internal, UU PDP)' })
  pdpAnonymise(@Body() dto: PdpAnonymiseDto): Promise<{ erased: number }> {
    return this.deliveries.erasePerson(dto.customerId, dto.phone ?? null);
  }
}
