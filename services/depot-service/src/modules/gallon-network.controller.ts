import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

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
  constructor(private readonly gallon: GallonNetworkService) {}

  @Roles(...CAPABILITIES.returnsRead)
  @Get()
  @ApiOperation({ summary: 'Per-depot outstanding empties + net deposit held (network)' })
  outstanding(): Promise<GallonOutstandingRow[]> {
    return this.gallon.outstanding();
  }
}
