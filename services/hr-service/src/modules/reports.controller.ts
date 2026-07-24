import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { CAPABILITIES } from '@hydromart/access';
import { AuthenticatedUser, CurrentUser, Roles } from '@hydromart/platform';

import { AnalyticsService, ReportData } from '../application/services/analytics.service';
import { toXlsx } from '../domain/xlsx';
import {
  AttendanceReportQueryDto,
  DashboardQueryDto,
  EmployeeReportQueryDto,
  PayrollReportQueryDto,
} from './dto/reports.dto';

/** HR dashboard aggregations + CSV/XLSX exports (?format=xlsx). Read = hrView, depot-scoped. */
@ApiTags('HR Reports')
@ApiBearerAuth()
@Controller({ path: 'hr-reports', version: '1' })
export class ReportsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('dashboard')
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'HR dashboard: headcount, today’s attendance, payroll totals' })
  dashboard(@Query() q: DashboardQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.analytics.dashboard(user, q);
  }

  @Get('employees')
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'Employee directory export (CSV or ?format=xlsx)' })
  async employees(@Query() q: EmployeeReportQueryDto, @CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    await this.deliver(res, 'employees', await this.analytics.employeeReport(user, q.depotId), q.format);
  }

  @Get('attendance')
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'Attendance export for a date range (CSV or ?format=xlsx)' })
  async attendance(@Query() q: AttendanceReportQueryDto, @CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    await this.deliver(res, `attendance-${q.from}_${q.to}`, await this.analytics.attendanceReport(user, q), q.format);
  }

  @Get('payroll')
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'Payroll export for a period (CSV or ?format=xlsx)' })
  async payroll(@Query() q: PayrollReportQueryDto, @CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    await this.deliver(res, `payroll-${q.periodMonth}`, await this.analytics.payrollReport(user, q), q.format);
  }

  private async deliver(res: Response, baseName: string, report: ReportData, format?: string): Promise<void> {
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.${format === 'xlsx' ? 'xlsx' : 'csv'}"`);
    if (format === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(await toXlsx(report.headers, report.rows, baseName));
      return;
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send('﻿' + this.analytics.csv(report)); // UTF-8 BOM so Excel reads it correctly
  }
}
