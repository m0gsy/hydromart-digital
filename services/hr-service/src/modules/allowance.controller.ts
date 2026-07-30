import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CAPABILITIES } from '@hydromart/access';
import { AuthenticatedUser, CurrentUser, Roles } from '@hydromart/platform';

import { AllowanceService } from '../application/services/allowance.service';
import { CreateAllowanceDto, ImportAllowancesDto, ListAllowanceDto } from './dto/allowance.dto';

/** Recurring pay components. Read hrView, write hrPayroll (it is salary, not master data). */
@ApiTags('HR Allowances')
@ApiBearerAuth()
@Controller({ path: 'allowances', version: '1' })
export class AllowanceController {
  constructor(private readonly allowances: AllowanceService) {}

  @Get()
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'List an employee’s allowances (active first)' })
  list(@Query() q: ListAllowanceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.allowances.list(user, q.employeeId);
  }

  @Post()
  @Roles(...CAPABILITIES.hrPayroll)
  @ApiOperation({ summary: 'Add a recurring allowance' })
  create(@Body() dto: CreateAllowanceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.allowances.add(user, dto);
  }

  @Post('import')
  @Roles(...CAPABILITIES.hrPayroll)
  @ApiOperation({ summary: 'Bulk-import recurring allowances from the CSV wizard' })
  import(@Body() dto: ImportAllowancesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.allowances.importMany(user, dto.rows);
  }

  @Patch(':id/deactivate')
  @Roles(...CAPABILITIES.hrPayroll)
  @ApiOperation({ summary: 'Stop an allowance (kept for payslip history)' })
  deactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.allowances.deactivate(user, id);
  }
}
