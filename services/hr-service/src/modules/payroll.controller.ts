import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CAPABILITIES } from '@hydromart/access';
import { AuthenticatedUser, CurrentUser, Roles } from '@hydromart/platform';

import { PayrollService } from '../application/services/payroll.service';
import { GeneratePayrollDto, ListPayrollDto } from './dto/payroll.dto';

/** Monthly payroll: generate (DRAFT) → approve → mark paid. Read = hrView; write = hrPayroll. */
@ApiTags('HR Payroll')
@ApiBearerAuth()
@Controller({ path: 'payroll', version: '1' })
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get()
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'List payroll runs' })
  list(@Query() query: ListPayrollDto) {
    return this.payroll.list(query);
  }

  @Get('me')
  @ApiOperation({ summary: 'My payroll history (self)' })
  listSelf(@Query() query: ListPayrollDto, @CurrentUser() user: AuthenticatedUser) {
    return this.payroll.listSelf(user, query);
  }

  @Get(':id')
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'Get one payroll with its item lines (salary slip)' })
  getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.payroll.getById(user, id);
  }

  @Post('generate')
  @Roles(...CAPABILITIES.hrPayroll)
  @ApiOperation({ summary: 'Generate/re-generate a DRAFT payroll for an employee + period' })
  generate(@Body() dto: GeneratePayrollDto, @CurrentUser() user: AuthenticatedUser) {
    return this.payroll.generate(user, dto.employeeId, dto.periodMonth);
  }

  @Post(':id/approve')
  @Roles(...CAPABILITIES.hrPayroll)
  @ApiOperation({ summary: 'Approve a DRAFT payroll' })
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.payroll.approve(user, id);
  }

  @Post(':id/pay')
  @Roles(...CAPABILITIES.hrPayroll)
  @ApiOperation({ summary: 'Mark an APPROVED payroll as paid' })
  pay(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.payroll.markPaid(user, id);
  }
}
