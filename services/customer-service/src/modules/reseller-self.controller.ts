import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser } from '@hydromart/platform';

import { ResellerService } from '../application/services/reseller.service';
import { Me2ResponseDto } from './dto/responses.generated.dto';

// Customer-facing reseller self endpoint. No @Roles → any authenticated user (the global
// JwtAuthGuard still applies). Lets checkout resolve the caller's own reseller pricing.
@ApiTags('Resellers')
@ApiBearerAuth()
@Controller({ path: 'resellers', version: '1' })
export class ResellerSelfController {
  constructor(private readonly resellers: ResellerService) {}

  @ApiOkResponse({ type: Me2ResponseDto })
  @Get('me')
  @ApiOperation({ summary: 'My reseller pricing (active + discount percent or flat galon price)' })
  async me(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{
    active: boolean;
    discountPct: number;
    flatGallonPriceIdr: number;
    homeDepotId: string;
  }> {
    const found = await this.resellers.findMy(user.sub);
    if (!found) throw new NotFoundException('Not a reseller');
    return {
      active: found.active,
      discountPct: found.discountPct,
      flatGallonPriceIdr: found.flatGallonPriceIdr,
      /*
       * A9. The counter route already answered with this; `/resellers/me` did not, and
       * order-service reads `homeDepotId === sellingDepotId` before it will price an agen.
       * Absent reads as "cannot prove which depot", which declines — so leaving it out
       * here does not merely block the cross-depot case A9 exists to block: it withdraws
       * the agen price from EVERY online order, at the agen's own depot included, with
       * nothing anywhere going red. Measured on a freshly built image before this line.
       */
      homeDepotId: found.homeDepotId,
    };
  }
}
