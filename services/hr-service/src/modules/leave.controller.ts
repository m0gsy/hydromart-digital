import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, ImportSummary } from '@hydromart/platform';

import { LeaveService } from '../application/services/leave.service';
import {
  DecideLeaveDto,
  ImportLeaveBalancesDto,
  LeaveBalanceQueryDto,
  ListLeaveDto,
  SubmitLeaveDto,
  SubmitLeaveForDto,
} from './dto/leave.dto';
import { LeaveBalance, LeaveRequest } from '../../prisma/generated/client';
import { ImportResponseDto, LeaveBalanceResponseDto, LeaveRequestResponseDto } from './dto/responses.generated.dto';

/** Self-service: any signed-in employee applies for and tracks their own leave. */
@ApiTags('HR Leave (self)')
@ApiBearerAuth()
@Controller({ path: 'leave/me', version: '1' })
export class SelfLeaveController {
  constructor(private readonly leave: LeaveService) {}

  @Get()
  @ApiOperation({ summary: 'My leave applications, newest first' })
  list(@Query() q: ListLeaveDto, @CurrentUser() user: AuthenticatedUser) {
    return this.leave.listSelf(user, q.page, q.pageSize);
  }

  @ApiOkResponse({ type: LeaveBalanceResponseDto })
  @Get('balance')
  @ApiOperation({ summary: 'My quota for a year (created on first read)' })
  balance(@Query() q: LeaveBalanceQueryDto, @CurrentUser() user: AuthenticatedUser): Promise<LeaveBalance> {
    return this.leave.myBalance(user, q.year);
  }

  @ApiOkResponse({ type: LeaveRequestResponseDto })
  @Post()
  @ApiOperation({ summary: 'Apply for leave' })
  submit(@Body() dto: SubmitLeaveDto, @CurrentUser() user: AuthenticatedUser): Promise<LeaveRequest> {
    return this.leave.submit(user, dto);
  }

  @ApiOkResponse({ type: LeaveRequestResponseDto })
  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Withdraw my application while it is still pending' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser): Promise<LeaveRequest> {
    return this.leave.cancel(user, id);
  }
}

/** Approval queue. Manager decides first, HR second — two different capabilities. */
@ApiTags('HR Leave')
@ApiBearerAuth()
@Controller({ path: 'leave', version: '1' })
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  @Get()
  @Can('hrView')
  @ApiOperation({ summary: 'Leave applications (depot-scoped for depot roles)' })
  list(@Query() q: ListLeaveDto, @CurrentUser() user: AuthenticatedUser) {
    return this.leave.listForApproval(user, q);
  }

  @ApiOkResponse({ type: ImportResponseDto })
  @Post('balances/import')
  @Can('hrAdmin')
  @ApiOperation({
    summary: 'Bulk-import opening leave balances from the CSV wizard',
    description:
      'Carries quota and days-already-taken over from a previous system. An existing year is overwritten and reported as updated.',
  })
  importBalances(@Body() dto: ImportLeaveBalancesDto, @CurrentUser() user: AuthenticatedUser): Promise<ImportSummary> {
    return this.leave.importBalances(user, dto.rows);
  }

  /**
   * CA-1-44: HR files an application for an employee who cannot file one.
   *
   * `hrAdmin`, the capability that already creates and corrects employee records — and NOT
   * `leaveApprove`: filing is not deciding, and the row enters the ordinary queue.
   */
  @ApiOkResponse({ type: LeaveRequestResponseDto })
  @Post('on-behalf')
  @Can('hrAdmin')
  @ApiOperation({ summary: 'File a leave application for an employee (enters the normal queue)' })
  onBehalf(
    @Body() dto: SubmitLeaveForDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LeaveRequest> {
    return this.leave.submitFor(user, dto.employeeId, dto);
  }

  @ApiOkResponse({ type: LeaveRequestResponseDto })
  @Patch(':id/manager-decision')
  @Can('leaveApprove')
  @ApiOperation({ summary: 'Stage 1: the manager approves or rejects' })
  manager(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideLeaveDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LeaveRequest> {
    return this.leave.decideManager(user, id, dto.approve, dto.note);
  }

  @ApiOkResponse({ type: LeaveRequestResponseDto })
  @Patch(':id/hr-decision')
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Stage 2: HR approves (writes the LEAVE attendance rows) or rejects' })
  hr(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideLeaveDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LeaveRequest> {
    return this.leave.decideHr(user, id, dto.approve, dto.note);
  }
}
