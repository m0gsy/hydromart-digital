import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { Can, AuthenticatedUser, CurrentUser, InternalAuthGuard, Public } from '@hydromart/platform';

import { AnalyticsService, ReportData } from '../application/services/analytics.service';
import { tableReportPdf } from '../domain/payroll-pdf';
import { toXlsx } from '../domain/xlsx';
import {
  AttendanceReportQueryDto,
  DashboardQueryDto,
  EmployeeReportQueryDto,
  PayrollReportQueryDto,
  RangeReportQueryDto,
} from './dto/reports.dto';
import { HrDashboard, HrDepotSummary } from '../application/services/analytics.service';
import { HrDashboardResponseDto, HrDepotResponseDto } from './dto/responses.generated.dto';

/** HR dashboard aggregations + CSV/XLSX exports (?format=xlsx). Read = hrView, depot-scoped. */
@ApiTags('HR Reports')
@ApiBearerAuth()
@Controller({ path: 'hr-reports', version: '1' })
export class ReportsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @ApiOkResponse({ type: HrDashboardResponseDto })
  @Get('dashboard')
  @Can('hrView')
  @ApiOperation({ summary: 'HR dashboard: headcount, today’s attendance, payroll totals' })
  dashboard(@Query() q: DashboardQueryDto, @CurrentUser() user: AuthenticatedUser): Promise<HrDashboard> {
    return this.analytics.dashboard(user, q);
  }

  // Service-to-service: dashboard-service pulls a per-depot HR summary for the owner
  // franchise dashboard (Fase 5). Internal key auth, same fail-closed path as other services.
  @ApiOkResponse({ type: HrDepotResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/depot-summary')
  @ApiOperation({
    summary: 'Per-depot HR summary: late/absent today, payroll MTD (internal service auth)',
  })
  depotSummary(@Query('depotId') depotId: string): Promise<HrDepotSummary> {
    return this.analytics.depotSummary(depotId);
  }

  // The batch of the route above: the owner dashboard asks for every depot it owns in one
  // call instead of one call per depot (audit S-1). Comma-separated ids; the response is
  // one row per requested id, in the order asked for.
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/depot-summaries')
  @ApiOperation({
    summary: 'Per-depot HR summary for MANY depots, one call (internal service auth)',
  })
  @ApiOkResponse({ type: HrDepotResponseDto, isArray: true })
  depotSummaries(@Query('depotIds') depotIds: string): Promise<HrDepotSummary[]> {
    const ids = (depotIds ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    return this.analytics.depotSummaryMany(ids);
  }

  @Get('employees')
  @Can('hrView')
  @ApiOperation({ summary: 'Employee directory export (CSV or ?format=xlsx)' })
  async employees(
    @Query() q: EmployeeReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    await this.deliver(
      res,
      'employees',
      await this.analytics.employeeReport(user, q.depotId),
      q.format,
    );
  }

  @Get('attendance')
  @Can('hrView')
  @ApiOperation({ summary: 'Attendance export for a date range (CSV or ?format=xlsx)' })
  async attendance(
    @Query() q: AttendanceReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    await this.deliver(
      res,
      `attendance-${q.from}_${q.to}`,
      await this.analytics.attendanceReport(user, q),
      q.format,
    );
  }

  @Get('payroll')
  @Can('hrView')
  @ApiOperation({ summary: 'Payroll export for a period (CSV or ?format=xlsx)' })
  async payroll(
    @Query() q: PayrollReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    await this.deliver(
      res,
      `payroll-${q.periodMonth}`,
      await this.analytics.payrollReport(user, q),
      q.format,
    );
  }

  @Get('late')
  @Can('hrView')
  @ApiOperation({ summary: 'Lateness export for a date range (CSV, xlsx or pdf)' })
  async late(
    @Query() q: AttendanceReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    await this.deliver(
      res,
      `late-${q.from}_${q.to}`,
      await this.analytics.lateReport(user, q),
      q.format,
      'Laporan Keterlambatan',
      `${q.from} s/d ${q.to}`,
    );
  }

  @Get('leave')
  @Can('hrView')
  @ApiOperation({ summary: 'Leave export — anything overlapping the range (CSV, xlsx or pdf)' })
  async leave(
    @Query() q: AttendanceReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    await this.deliver(
      res,
      `leave-${q.from}_${q.to}`,
      await this.analytics.leaveReport(user, q),
      q.format,
      'Laporan Cuti',
      `${q.from} s/d ${q.to}`,
    );
  }

  @Get('performance')
  @Can('hrView')
  @ApiOperation({ summary: 'Performance export for a period (CSV, xlsx or pdf)' })
  async performance(
    @Query() q: PayrollReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    await this.deliver(
      res,
      `performance-${q.periodMonth}`,
      await this.analytics.performanceReport(user, q),
      q.format,
      'Laporan Kinerja',
      `Periode ${q.periodMonth}`,
    );
  }

  @Get('assets')
  @Can('hrView')
  @ApiOperation({ summary: 'Asset register export (CSV, xlsx or pdf)' })
  async assets(
    @Query() q: EmployeeReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    await this.deliver(
      res,
      'assets',
      await this.analytics.assetReport(user, q.depotId),
      q.format,
      'Laporan Aset',
    );
  }

  @Get('announcements')
  @Can('hrView')
  @ApiOperation({ summary: 'Announcement reach & read-rate export (CSV, xlsx or pdf)' })
  async announcements(@Query() q: RangeReportQueryDto, @Res() res: Response) {
    await this.deliver(
      res,
      `announcements-${q.from}_${q.to}`,
      await this.analytics.announcementReport(q),
      q.format,
      'Laporan Pengumuman',
      `${q.from} s/d ${q.to}`,
    );
  }

  private async deliver(
    res: Response,
    baseName: string,
    report: ReportData,
    format?: string,
    pdfTitle?: string,
    pdfSubtitle?: string,
  ): Promise<void> {
    const ext = format === 'xlsx' || format === 'pdf' ? format : 'csv';
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.${ext}"`);
    if (format === 'xlsx') {
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.send(await toXlsx(report.headers, report.rows, baseName));
      return;
    }
    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.send(
        await tableReportPdf({
          title: pdfTitle ?? baseName,
          subtitle: pdfSubtitle,
          headers: report.headers,
          rows: report.rows,
        }),
      );
      return;
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send('﻿' + this.analytics.csv(report)); // UTF-8 BOM so Excel reads it correctly
  }
}
