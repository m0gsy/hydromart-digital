import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, AuthenticatedUser, CurrentUser } from '@hydromart/platform';

import { BonusRuleService } from '../application/services/bonus-rule.service';
import { LoanService } from '../application/services/loan.service';
import {
  CreateBonusRuleDto,
  CreateLoanDto,
  ImportLoansDto,
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
  @Can('hrView')
  @ApiOperation({ summary: 'List auto-bonus rules (depotId=global for network-wide)' })
  list(@Query() q: ListBonusRuleDto) {
    const depotId = q.depotId === undefined ? undefined : q.depotId === 'global' ? null : q.depotId;
    return this.rules.list(depotId);
  }

  @Post()
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Create an auto-bonus rule' })
  create(@Body() dto: CreateBonusRuleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.rules.create(user, dto);
  }

  @Patch(':id')
  @Can('hrAdmin')
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
  @Can('hrView')
  @ApiOperation({ summary: 'List an employee’s loans with computed remaining balance' })
  list(@Query() q: ListLoanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.loans.listByEmployee(user, q.employeeId, q.asOfPeriod ?? '');
  }

  @Post()
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Create an employee loan / kasbon' })
  create(@Body() dto: CreateLoanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.loans.create(user, dto);
  }

  @Post('import')
  @Can('hrAdmin')
  @ApiOperation({
    summary: 'Bulk-import running loans from the CSV wizard',
    description: 'principal = the balance still owed at startPeriod, not the original amount.',
  })
  import(@Body() dto: ImportLoansDto, @CurrentUser() user: AuthenticatedUser) {
    return this.loans.importMany(user, dto.rows);
  }

  @Patch(':id/deactivate')
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Stop further deductions for a loan' })
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.loans.deactivate(user, id);
  }
}
