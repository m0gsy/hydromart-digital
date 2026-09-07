import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import { Can, AuthenticatedUser, CurrentUser, InternalAuthGuard, Public } from '@hydromart/platform';

import { ExpenseClaimService } from '../application/services/expense-claim.service';
import { ExpenseClaimRecord } from '../application/ports/expense-claim.repository';
import { Page } from '../application/pagination';
import {
  DepotPayoutCostsQueryDto,
  ExpenseQueryDto,
  ReviewExpenseDto,
} from './dto/expense-claim.dto';
import {
  DepotPayoutCostsResponseDto,
  ExpenseClaimResponseDto,
  PagedExpenseClaimResponseDto,
} from './dto/responses.generated.dto';

// Reviewer-scoped: depot managers / finance approve or reject courier claims (design 6a).
// expenseApprove excludes STAFF_DEPOT, so a courier can never approve their own claim.
@ApiTags('Expense Approval')
@ApiBearerAuth()
@Can('expenseApprove')
@Controller({ path: 'expenses', version: '1' })
export class ExpenseApprovalController {
  constructor(private readonly expenses: ExpenseClaimService) {}

  /**
   * CA-2-59: courier commission and approved expense claims per depot, for the network P&L.
   *
   * Internal key rather than `expenseApprove`: the caller is dashboard-service composing a
   * head-office report and holds no token for any of these depots. `@Public()`
   * short-circuits RolesGuard so the class-level `@Can` cannot 403 a request that is
   * deliberately identity-less — the same shape depot-service's `internal/depot-costs`
   * uses. Declared FIRST so the static `internal` segment wins over any `:param` route.
   */
  @ApiOkResponse({ type: DepotPayoutCostsResponseDto, isArray: true })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/depot-costs')
  @ApiOperation({
    summary: 'Courier commission + approved claims per depot over a window (internal)',
  })
  internalDepotCosts(
    @Query() query: DepotPayoutCostsQueryDto,
  ): Promise<{ depotId: string; commissionIdr: number; expenseClaimIdr: number }[]> {
    const ids = query.depotIds
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    return this.expenses.costsByDepot(ids, new Date(query.from), new Date(query.to));
  }

  @ApiOkResponse({ type: PagedExpenseClaimResponseDto })
  @Get()
  @ApiOperation({ summary: 'Search courier expense claims by depot + status' })
  list(
    @Query() query: ExpenseQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Page<ExpenseClaimRecord>> {
    return this.expenses.searchForDepot(
      query.depotId ?? null,
      query.status ?? null,
      query.page,
      query.limit,
      // AUTHZ-A5: "all depots" means the reviewer's own depots when they have any.
      user,
    );
  }

  @ApiOkResponse({ type: ExpenseClaimResponseDto })
  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a pending claim; credits the courier ledger' })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReviewExpenseDto,
  ): Promise<ExpenseClaimRecord> {
    return this.expenses.approve(id, user.sub, dto.note, user);
  }

  @ApiOkResponse({ type: ExpenseClaimResponseDto })
  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a pending claim (no ledger movement)' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReviewExpenseDto,
  ): Promise<ExpenseClaimRecord> {
    return this.expenses.reject(id, user.sub, dto.note, user);
  }
}
