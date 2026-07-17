import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Roles } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { ExpenseClaimService } from '../application/services/expense-claim.service';
import { ExpenseClaimRecord } from '../application/ports/expense-claim.repository';
import { Page } from '../application/pagination';
import { ExpenseQueryDto, ReviewExpenseDto } from './dto/expense-claim.dto';

// Reviewer-scoped: depot managers / finance approve or reject courier claims (design 6a).
// expenseApprove excludes DRIVER, so a courier can never approve their own claim.
@ApiTags('Expense Approval')
@ApiBearerAuth()
@Roles(...CAPABILITIES.expenseApprove)
@Controller({ path: 'expenses', version: '1' })
export class ExpenseApprovalController {
  constructor(private readonly expenses: ExpenseClaimService) {}

  @Get()
  @ApiOperation({ summary: 'Search courier expense claims by depot + status' })
  list(@Query() query: ExpenseQueryDto): Promise<Page<ExpenseClaimRecord>> {
    return this.expenses.searchForDepot(
      query.depotId ?? null,
      query.status ?? null,
      query.page,
      query.limit,
    );
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a pending claim; credits the courier ledger' })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReviewExpenseDto,
  ): Promise<ExpenseClaimRecord> {
    return this.expenses.approve(id, user.sub, dto.note);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a pending claim (no ledger movement)' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReviewExpenseDto,
  ): Promise<ExpenseClaimRecord> {
    return this.expenses.reject(id, user.sub, dto.note);
  }
}
