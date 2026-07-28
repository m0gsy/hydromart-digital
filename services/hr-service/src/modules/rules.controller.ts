import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CAPABILITIES } from '@hydromart/access';
import { AuthenticatedUser, CurrentUser, Roles } from '@hydromart/platform';

import { BonusRuleService } from '../application/services/bonus-rule.service';
import { LoanService } from '../application/services/loan.service';
import {
  CreateBonusRuleDto,
  CreateLoanDto,
  ListBonusRuleDto,
  ListLoanDto,
  UpdateBonusRuleDto,
} from './dto/rules.dto';

@ApiTags('HR Bonus Rules')
@ApiBearerAuth()
@Controller({ path: 'bonus-rules', version: '1' })
export class BonusRuleController {
  constructor(private readonly rules: BonusRuleService) {}

  @Get()
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'List auto-bonus rules (depotId=global for network-wide)' })
  list(@Query() q: ListBonusRuleDto) {
    const depotId = q.depotId === undefined ? undefined : q.depotId === 'global' ? null : q.depotId;
    return this.rules.list(depotId);
  }

  @Post()
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Create an auto-bonus rule' })
  create(@Body() dto: CreateBonusRuleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.rules.create(user, dto);
  }

  @Patch(':id')
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Update an auto-bonus rule' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBonusRuleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rules.update(user, id, dto);
  }
}

@ApiTags('HR Loans')
@ApiBearerAuth()
@Controller({ path: 'loans', version: '1' })
export class LoanController {
  constructor(private readonly loans: LoanService) {}

  @Get()
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'List an employee’s loans with computed remaining balance' })
  list(@Query() q: ListLoanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.loans.listByEmployee(user, q.employeeId, q.asOfPeriod ?? '');
  }

  @Post()
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Create an employee loan / kasbon' })
  create(@Body() dto: CreateLoanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.loans.create(user, dto);
  }

  @Patch(':id/deactivate')
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Stop further deductions for a loan' })
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.loans.deactivate(user, id);
  }
}
