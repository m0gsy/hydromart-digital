import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import {
  AI_READ_REPOSITORY,
  AiReadRepository,
  AttendanceDepotRow,
  AttendanceHeads,
  KasbonDepotRow,
  PayrollDepotRow,
  PayrollGateRow,
} from '../application/ports/ai-read.repository';
import { AiAttendanceQueryDto, AiAttendanceResponseDto, AiMonthQueryDto } from './dto/ai-read.dto';

/**
 * HD-6 H5, dashboard-service's AI read API: HR figures as counts and sums per depot. Internal key
 * only; no row names an employee. The caller passes the depots and days it may read: these reads do
 * no scoping of their own.
 */
@ApiTags('HR AI read (internal)')
@Public()
@UseGuards(InternalAuthGuard)
@ApiSecurity('internal-key')
@Controller({ path: 'hr-reports/internal/ai', version: '1' })
export class AiReadInternalController {
  constructor(@Inject(AI_READ_REPOSITORY) private readonly repo: AiReadRepository) {}

  @ApiOkResponse({ type: AiAttendanceResponseDto })
  @Get('attendance')
  @ApiOperation({ summary: 'Attendance counts per depot over [from, to] (internal)' })
  attendance(@Query() q: AiAttendanceQueryDto): Promise<{ rows: AttendanceDepotRow[]; heads: AttendanceHeads; rolledUp: boolean }> {
    return this.repo.attendance(q.depotIds, q.from, q.to);
  }

  @ApiOkResponse({ description: 'One row per depot asked for.' })
  @Get('payroll-gate')
  @ApiOperation({ summary: 'Is the month of payroll finished, per depot, by the employee home depot (internal)' })
  payrollGate(@Query() q: AiMonthQueryDto): Promise<PayrollGateRow[]> {
    return this.repo.payrollGate(q.depotIds, q.month);
  }

  @ApiOkResponse({ description: 'One row per depot asked for.' })
  @Get('payroll')
  @ApiOperation({ summary: 'APPROVED/PAID payslip totals of a month per depot (internal)' })
  payroll(@Query() q: AiMonthQueryDto): Promise<PayrollDepotRow[]> {
    return this.repo.payroll(q.depotIds, q.month);
  }

  @ApiOkResponse({ description: 'One row per depot asked for.' })
  @Get('kasbon')
  @ApiOperation({ summary: 'What is still owed on active kasbon through a month per depot (internal)' })
  kasbon(@Query() q: AiMonthQueryDto): Promise<KasbonDepotRow[]> {
    return this.repo.kasbon(q.depotIds, q.month);
  }
}
