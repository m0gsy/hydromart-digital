import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can } from '@hydromart/platform';

import { CommissionService } from '../application/services/commission.service';
import { CommissionSchemeRecord } from '../domain/commission';
import { ApplySchemeDto } from './dto/commission.dto';
import { CommissionSchemeResponseDto } from './dto/responses.generated.dto';

/**
 * HQ commission-scheme config (design 21c). Finance-owned: FINANCE + SUPER_ADMIN,
 * gated directly on the roles (this config is not part of the per-depot capability
 * matrix). Depot names/list come from depot-service on the web side; this service
 * only owns the payout percentages.
 */
@ApiTags('Commission')
@ApiBearerAuth()
@Can('commissionRuns')
@Controller({ path: 'commission', version: '1' })
export class CommissionController {
  constructor(private readonly commission: CommissionService) {}

  // Reading the agreed cut is not applying one. /hq/reconciliation and /hq/franchise show
  // this percentage to head office — and on the reconciliation statement it IS the line a
  // franchise owner reads as what they are owed — while `commissionRuns` below stays with
  // the roles that may change it.
  @ApiOkResponse({ type: CommissionSchemeResponseDto, isArray: true })
  @Can('commissionRead')
  @Get('schemes')
  @ApiOperation({ summary: 'Current commission percentage per depot (latest effective scheme)' })
  listSchemes(): Promise<CommissionSchemeRecord[]> {
    return this.commission.listCurrent();
  }

  @ApiOkResponse({ type: CommissionSchemeResponseDto, isArray: true })
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
