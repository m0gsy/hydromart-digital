import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { Can, AuthenticatedUser, CurrentUser } from '@hydromart/platform';

import { PayrollService } from '../application/services/payroll.service';
import { GeneratePayrollDto, ListPayrollDto } from './dto/payroll.dto';
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
  list(@Query() query: ListPayrollDto) {
    return this.payroll.list(query);
  }

  @Get('me')
  @ApiOperation({ summary: 'My payroll history (self)' })
  listSelf(@Query() query: ListPayrollDto, @CurrentUser() user: AuthenticatedUser) {
    return this.payroll.listSelf(user, query);
  }

  @ApiOkResponse({ type: PayrollWithItemsResponseDto })
  @Get(':id')
  @Can('hrView')
  @ApiOperation({ summary: 'Get one payroll with its item lines (salary slip)' })
  getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser): Promise<PayrollWithItems> {
    return this.payroll.getById(user, id);
  }

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
