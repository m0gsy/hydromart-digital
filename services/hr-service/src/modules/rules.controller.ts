import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, ImportSummary } from '@hydromart/platform';

import { BonusRuleService } from '../application/services/bonus-rule.service';
import { LoanListView, LoanService } from '../application/services/loan.service';
import {
  CreateBonusRuleDto,
  CreateLoanDto,
  ImportLoansDto,
  ListBonusRuleDto,
  ListAllLoansDto,
  ListLoanDto,
  UpdateBonusRuleDto,
} from './dto/rules.dto';
import { BonusRule, Loan } from '../../prisma/generated/client';
import { LoanView } from '../application/services/loan.service';
import { BonusRuleResponseDto, ImportResponseDto, LoanResponseDto } from './dto/responses.generated.dto';

@ApiTags('HR Bonus Rules')
@ApiBearerAuth()
@Controller({ path: 'bonus-rules', version: '1' })
export class BonusRuleController {
  constructor(private readonly rules: BonusRuleService) {}

  @ApiOkResponse({ type: BonusRuleResponseDto, isArray: true })
  @Get()
  @Can('hrView')
  @ApiOperation({ summary: 'List auto-bonus rules (depotId=global for network-wide)' })
  list(@Query() q: ListBonusRuleDto): Promise<BonusRule[]> {
    const depotId = q.depotId === undefined ? undefined : q.depotId === 'global' ? null : q.depotId;
    return this.rules.list(depotId);
  }

  @ApiOkResponse({ type: BonusRuleResponseDto })
  @Post()
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Create an auto-bonus rule' })
  create(@Body() dto: CreateBonusRuleDto, @CurrentUser() user: AuthenticatedUser): Promise<BonusRule> {
    return this.rules.create(user, dto);
  }

  @ApiOkResponse({ type: BonusRuleResponseDto })
  @Patch(':id')
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Update an auto-bonus rule' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBonusRuleDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BonusRule> {
    return this.rules.update(user, id, dto);
  }
}

@ApiTags('HR Loans')
@ApiBearerAuth()
@Controller({ path: 'loans', version: '1' })
export class LoanController {
  constructor(private readonly loans: LoanService) {}

  @ApiOkResponse({ type: LoanResponseDto, isArray: true })
  @Get()
  @Can('hrView')
  @ApiOperation({ summary: 'List an employee’s loans with computed remaining balance' })
  list(@Query() q: ListLoanDto, @CurrentUser() user: AuthenticatedUser): Promise<LoanView[]> {
    return this.loans.listByEmployee(user, q.employeeId, q.asOfPeriod ?? '');
  }

  /*
   * CA-1-34: every loan on the books. Declared before `@Post()` for readability only —
   * they are different verbs, so route order does not matter here.
   *
   * `hrView`, the same capability as the per-employee list, and scoped by depot inside the
   * service: a supervisor sees their own depot's kasbon, HQ sees the network.
   */
  @ApiOkResponse({ type: LoanResponseDto, isArray: true })
  @Get('all')
  @Can('hrView')
  @ApiOperation({ summary: 'List every loan on the books (paged, depot-scoped)' })
  listAll(
    @Query() q: ListAllLoansDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ rows: LoanListView[]; total: number }> {
    return this.loans.listAll(user, q);
  }

  @ApiOkResponse({ type: LoanResponseDto })
  @Post()
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Create an employee loan / kasbon' })
  create(@Body() dto: CreateLoanDto, @CurrentUser() user: AuthenticatedUser): Promise<Loan> {
    return this.loans.create(user, dto);
  }

  @ApiOkResponse({ type: ImportResponseDto })
  @Post('import')
  @Can('hrAdmin')
  @ApiOperation({
    summary: 'Bulk-import running loans from the CSV wizard',
    description: 'principal = the balance still owed at startPeriod, not the original amount.',
  })
  import(@Body() dto: ImportLoansDto, @CurrentUser() user: AuthenticatedUser): Promise<ImportSummary> {
    return this.loans.importMany(user, dto.rows);
  }

  @ApiOkResponse({ type: LoanResponseDto })
  @Patch(':id/deactivate')
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Stop further deductions for a loan' })
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<Loan> {
    return this.loans.deactivate(user, id);
  }
}
