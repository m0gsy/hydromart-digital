import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, AuthenticatedUser, Role, Roles } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { DepotService } from '../application/services/depot.service';
import {
  GallonNetworkService,
  GallonOutstandingRow,
} from '../application/services/gallon-network.service';

/**
 * Network gallon rollup (HQ compare 14d + reconciliation 22a). Distinct static path so
 * it never collides with the depot `:id` routes. Read-only, HQ ops read roles.
 */
@ApiTags('Gallon network')
@ApiBearerAuth()
@Controller({ path: 'gallon-outstanding', version: '1' })
export class GallonNetworkController {
  constructor(
    private readonly gallon: GallonNetworkService,
    private readonly depots: DepotService,
  ) {}

  @Roles(...CAPABILITIES.returnsRead)
  @Get()
  @ApiOperation({ summary: 'Per-depot outstanding empties + net deposit held (network)' })
  async outstanding(@CurrentUser() user: AuthenticatedUser): Promise<GallonOutstandingRow[]> {
    const rows = await this.gallon.outstanding();
    // A franchise owner sees only depots they own, never the whole network (returnsRead is
    // shared with HQ). Everyone else on the cap keeps the full network rollup.
    if (user.role === Role.FRANCHISE_OWNER) {
      const owned = new Set((await this.depots.listMine(user.sub)).map((d) => d.id));
      return rows.filter((r) => owned.has(r.depotId));
    }
    return rows;
  }
}
