import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, CurrentUser, AuthenticatedUser } from '@hydromart/platform';
import { can } from '@hydromart/access';

import { CashierShiftService } from '../application/services/cashier-shift.service';
import { CashierShift } from '../domain/cashier-shift';
import { CloseShiftDto, OpenShiftDto, ShiftQueryDto } from './dto/cashier-shift.dto';
import { CashierShiftResponseDto, ListResponseDto } from './dto/responses.generated.dto';

/**
 * Cashier shifts (counter chain of custody). Everything here is depot-money handling, so
 * it rides the same capability as the counter sale itself.
 */
@ApiTags('Cashier shift')
@ApiBearerAuth()
@Can('cashierShift')
@Controller({ path: 'cashier-shifts', version: '1' })
export class CashierShiftController {
  constructor(private readonly shifts: CashierShiftService) {}

  @ApiOkResponse({ type: CashierShiftResponseDto })
  @Post()
  @ApiOperation({ summary: 'Open a shift with the drawer float' })
  open(@Body() dto: OpenShiftDto, @CurrentUser() user: AuthenticatedUser): Promise<CashierShift> {
    // The token carries no display name, and the shift row must still say who was at the
    // counter months later — the phone is the identifier a depot actually recognises.
    return this.shifts.open(dto, { id: user.sub, name: user.phone ?? user.sub });
  }

  @ApiOkResponse({ type: CashierShiftResponseDto })
  @Get('current')
  @ApiOperation({ summary: "The caller's own open shift at a depot, or null" })
  current(
    @Query() query: ShiftQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CashierShift | null> {
    return this.shifts.current(query.depotId, user.sub);
  }

  @ApiOkResponse({ type: ListResponseDto })
  @Get()
  @ApiOperation({ summary: 'Open shifts at a depot plus the latest closed ones' })
  list(@Query() query: ShiftQueryDto): Promise<{ open: CashierShift[]; closed: CashierShift[] }> {
    return this.shifts.list(query.depotId);
  }

  @ApiOkResponse({ type: CashierShiftResponseDto })
  @Post(':id/close')
  @ApiOperation({ summary: 'Count the drawer and close the shift (expected cash is server-side)' })
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseShiftDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CashierShift> {
    return this.shifts.close(id, dto, {
      id: user.sub,
      // A cashier who walked out without closing still leaves a drawer to reconcile, so
      // whoever runs the depot may close it for them. Nobody else may.
      canCloseAnyShift: can('depotFinance', user.role),
    });
  }
}
