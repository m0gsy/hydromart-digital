import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import { CommissionService } from '../application/services/commission.service';
import { CommissionSchemeRecord } from '../domain/commission';
import { ApplySchemeDto } from './dto/commission.dto';

/**
 * HQ commission-scheme config (design 21c). Finance-owned: FINANCE + SUPER_ADMIN,
 * gated directly on the roles (this config is not part of the per-depot capability
 * matrix). Depot names/list come from depot-service on the web side; this service
 * only owns the payout percentages.
 */
@ApiTags('Commission')
@ApiBearerAuth()
@Roles(Role.FINANCE, Role.SUPER_ADMIN)
@Controller({ path: 'commission', version: '1' })
export class CommissionController {
  constructor(private readonly commission: CommissionService) {}

  @Get('schemes')
  @ApiOperation({ summary: 'Current commission percentage per depot (latest effective scheme)' })
  listSchemes(): Promise<CommissionSchemeRecord[]> {
    return this.commission.listCurrent();
  }

  @Post('schemes/apply')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Apply a new commission scheme (bulk per-depot %, effective date)' })
  apply(@Body() dto: ApplySchemeDto): Promise<CommissionSchemeRecord[]> {
    return this.commission.apply({
      effectiveDate: new Date(dto.effectiveDate),
      items: dto.items,
    });
  }
}
