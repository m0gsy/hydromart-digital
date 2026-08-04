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
  @ApiOperation({ summary: 'My reseller pricing (active + discount percent)' })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<{ active: boolean; discountPct: number }> {
    const found = await this.resellers.findMy(user.sub);
    if (!found) throw new NotFoundException('Not a reseller');
    return { active: found.active, discountPct: found.discountPct };
  }
}
