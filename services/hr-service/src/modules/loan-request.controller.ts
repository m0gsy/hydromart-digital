import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser } from '@hydromart/platform';

import { LoanRequest } from '../../prisma/generated/client';
import { LoanRequestService } from '../application/services/loan-request.service';
import {
  DecideLoanRequestDto,
  ListLoanRequestDto,
  SubmitLoanRequestDto,
} from './dto/loan-request.dto';
import { LoanRequestResponseDto, PagedLoanRequestResponseDto } from './dto/responses.generated.dto';

/**
 * Self-service: any signed-in employee raises and tracks their own kasbon.
 *
 * No `@Can` and no `@Roles`, on purpose — `check-route-authz.mjs` recognises a route as
 * self-scoped when it takes `@CurrentUser()`, and the subject IS the caller: every method
 * resolves the employee from the token and can only ever reach that person's own rows. The
 * same shape `SelfLeaveController` uses.
 */
@ApiTags('HR Kasbon (self)')
@ApiBearerAuth()
@Controller({ path: 'loan-requests/me', version: '1' })
export class SelfLoanRequestController {
  constructor(private readonly requests: LoanRequestService) {}

  @ApiOkResponse({ type: [LoanRequestResponseDto] })
  @Get()
  @ApiOperation({ summary: 'My kasbon requests, newest first' })
  list(@CurrentUser() user: AuthenticatedUser): Promise<LoanRequest[]> {
    return this.requests.listSelf(user);
  }

  @ApiOkResponse({ type: LoanRequestResponseDto })
  @Post()
  @ApiOperation({ summary: 'Raise a kasbon request (amount and reason only)' })
  submit(
    @Body() dto: SubmitLoanRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LoanRequest> {
    return this.requests.submit(user, dto);
  }

  @ApiOkResponse({ type: LoanRequestResponseDto })
  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Withdraw my request while it is still pending' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LoanRequest> {
    return this.requests.cancel(user, id);
  }
}

/** The decision queue. `kasbonApprove` — see the reason written on the capability. */
@ApiTags('HR Kasbon')
@ApiBearerAuth()
@Controller({ path: 'loan-requests', version: '1' })
export class LoanRequestController {
  constructor(private readonly requests: LoanRequestService) {}

  @ApiOkResponse({ type: PagedLoanRequestResponseDto })
  @Can('kasbonApprove')
  @Get()
  @ApiOperation({ summary: 'Kasbon awaiting a decision, depot-scoped' })
  list(@Query() q: ListLoanRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requests.listAll(user, q);
  }

  @ApiOkResponse({ type: LoanRequestResponseDto })
  @Can('kasbonApprove')
  @Patch(':id/decide')
  @ApiOperation({ summary: 'Approve (setting the instalment terms) or reject one' })
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideLoanRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LoanRequest> {
    return this.requests.decide(user, id, dto);
  }
}
