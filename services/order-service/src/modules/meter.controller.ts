import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser } from '@hydromart/platform';

import { MeterService } from '../application/services/meter.service';
import { MeterHistoryRow, MeterReconciliation } from '../domain/meter-reading';
import { MeterHistoryQueryDto, SaveMeterReadingDto } from './dto/meter-reading.dto';
import {
  MeterHistoryRowResponseDto,
  MeterReconciliationResponseDto,
} from './dto/responses.generated.dto';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_HISTORY_DAYS = 92;

/** Rejects '2026-13-45' style values before they reach a Date that would coerce them. */
function assertDay(value: string): string {
  if (!DAY_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    throw new BadRequestException('date must be YYYY-MM-DD');
  }
  return value;
}

function toDay(value: Date): string {
  // tz-ok: @db.Date coming back out of the service — already a local calendar day.
  return value.toISOString().slice(0, 10);
}

@ApiTags('Reports')
@ApiBearerAuth()
@Controller({ path: 'reports/meter', version: '1' })
export class MeterController {
  constructor(private readonly meter: MeterService) {}

  @ApiOkResponse({ type: MeterReconciliationResponseDto })
  @Can('meterWrite')
  @Put(':depotId/:date')
  @ApiOperation({
    summary: "Record a depot's water-meter reading (call once at opening, once at closing)",
  })
  save(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Param('date') date: string,
    @Body() dto: SaveMeterReadingDto,
    @CurrentUser() user: AuthenticatedUser,
    // Forwarded to crm-service with the variance alert, same as the order lifecycle
    // notifications do.
    @Headers('authorization') authorization?: string,
  ): Promise<MeterReconciliation> {
    return this.meter.save({
      depotId,
      date: assertDay(date),
      actorId: user.sub,
      authorization: authorization ?? '',
      ...dto,
    });
  }

  @ApiOkResponse({ type: MeterReconciliationResponseDto })
  @Can('meterRead')
  @Get(':depotId/:date')
  @ApiOperation({ summary: 'Water-meter reading and reconciliation for one day' })
  reconcile(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Param('date') date: string,
  ): Promise<MeterReconciliation> {
    return this.meter.reconcile(depotId, assertDay(date));
  }

  @ApiOkResponse({ type: MeterHistoryRowResponseDto, isArray: true })
  @Can('meterRead')
  @Get(':depotId')
  @ApiOperation({ summary: 'Daily water-meter history for the variance chart' })
  history(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Query() query: MeterHistoryQueryDto,
  ): Promise<MeterHistoryRow[]> {
    const to = query.to ? assertDay(query.to.slice(0, 10)) : toDay(new Date());
    const from = query.from
      ? assertDay(query.from.slice(0, 10))
      : toDay(new Date(Date.parse(`${to}T00:00:00.000Z`) - 29 * DAY_MS));
    if (Date.parse(`${from}T00:00:00.000Z`) > Date.parse(`${to}T00:00:00.000Z`)) {
      throw new BadRequestException('from must not be after to');
    }
    // Bounded so one request cannot fan out into a per-day order scan of arbitrary
    // length — each day in the range costs its own orders query.
    const days = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS;
    if (days > MAX_HISTORY_DAYS) {
      throw new BadRequestException(`range must not exceed ${MAX_HISTORY_DAYS} days`);
    }
    return this.meter.history(depotId, from, to);
  }
}
