import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { Can, AuthenticatedUser, CurrentUser } from '@hydromart/platform';

import { PayrollService } from '../application/services/payroll.service';
import {
  GenerateBatchPayrollDto,
  GenerateBatchResultDto,
  GeneratePayrollDto,
  ListPayrollDto,
} from './dto/payroll.dto';
import { PayrollWithItems } from '../application/ports/payroll.repository';
import { PayrollWithItemsResponseDto } from './dto/responses.generated.dto';

/** Monthly payroll: generate (DRAFT) → approve → mark paid. Read = hrView; write = hrPayroll. */
@ApiTags('HR Payroll')
@ApiBearerAuth()
@Controller({ path: 'payroll', version: '1' })
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get()
  @Can('hrView')
  @ApiOperation({ summary: 'List payroll runs' })
  list(@Query() query: ListPayrollDto, @CurrentUser() user: AuthenticatedUser) {
    return this.payroll.list(user, query);
  }

  @Get('me')
  @ApiOperation({ summary: 'My payroll history (self)' })
  listSelf(@Query() query: ListPayrollDto, @CurrentUser() user: AuthenticatedUser) {
    return this.payroll.listSelf(user, query);
  }

  /**
   * The caller's own payslip, by id.
   *
   * `GET :id` below is `hrView`-gated and no ordinary employee has that capability, so
   * "Slip Gaji Saya" could list payslips and then 403 on opening one. Scoped by ownership
   * in the service — a payroll belonging to somebody else 404s rather than 403s.
   *
   * Two path segments, so the single-segment `:id` route cannot swallow it.
   */
  @ApiOkResponse({ type: PayrollWithItemsResponseDto })
  @Get('me/:id')
  @ApiOperation({ summary: 'One of my own payslips with its item lines (self)' })
  getSelfById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PayrollWithItems> {
    return this.payroll.getSelfById(user, id);
  }

  @ApiOkResponse({
    description: 'The salary slip as a PDF.',
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  @Get('me/:id/slip')
  @ApiOperation({ summary: 'Download one of my own payslips as a PDF (self)' })
  async selfSlip(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const pdf = await this.payroll.selfSlip(user, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="slip-${id}.pdf"`);
    res.send(pdf);
  }

  @ApiOkResponse({ type: PayrollWithItemsResponseDto })
  @Get(':id')
  @Can('hrView')
  @ApiOperation({ summary: 'Get one payroll with its item lines (salary slip)' })
  getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser): Promise<PayrollWithItems> {
    return this.payroll.getById(user, id);
  }

  @ApiOkResponse({
    description: 'The salary slip as a PDF.',
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  @Get(':id/slip')
  @Can('hrView')
  @ApiOperation({ summary: 'Download a payroll as a salary-slip PDF' })
  async slip(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const pdf = await this.payroll.slip(user, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="slip-${id}.pdf"`);
    res.send(pdf);
  }

  @ApiOkResponse({ type: PayrollWithItemsResponseDto })
  @Post('generate')
  @Can('hrPayroll')
  @ApiOperation({ summary: 'Generate/re-generate a DRAFT payroll for an employee + period' })
  generate(@Body() dto: GeneratePayrollDto, @CurrentUser() user: AuthenticatedUser): Promise<PayrollWithItems> {
    return this.payroll.generate(user, dto.employeeId, dto.periodMonth);
  }

  /**
   * D10. One depot, one period, DRAFTs for everyone active. Approve and pay stay manual and
   * per-person — this prepares, it does not move money, and there is no cron behind it.
   * The per-employee summary is the point: a batch that quietly skipped someone is worse
   * than no batch, because nobody notices a missing payslip until payday.
   */
  @ApiOkResponse({ type: GenerateBatchResultDto })
  @Post('generate-batch')
  @Can('hrPayroll')
  @ApiOperation({ summary: 'Generate DRAFT payroll for every active employee of one depot' })
  generateBatch(
    @Body() dto: GenerateBatchPayrollDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<GenerateBatchResultDto> {
    return this.payroll.generateBatch(user, dto.depotId, dto.periodMonth);
  }

  @ApiOkResponse({ type: PayrollWithItemsResponseDto })
  @Post(':id/approve')
  @Can('hrPayroll')
  @ApiOperation({ summary: 'Approve a DRAFT payroll' })
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser): Promise<PayrollWithItems> {
    return this.payroll.approve(user, id);
  }

  @ApiOkResponse({ type: PayrollWithItemsResponseDto })
  @Post(':id/pay')
  @Can('hrPayroll')
  @ApiOperation({ summary: 'Mark an APPROVED payroll as paid' })
  pay(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser): Promise<PayrollWithItems> {
    return this.payroll.markPaid(user, id);
  }
}
