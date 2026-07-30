import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CAPABILITIES } from '@hydromart/access';
import { AuthenticatedUser, CurrentUser, Roles } from '@hydromart/platform';

import { LeaveService } from '../application/services/leave.service';
import {
  DecideLeaveDto,
  ImportLeaveBalancesDto,
  LeaveBalanceQueryDto,
  ListLeaveDto,
  SubmitLeaveDto,
} from './dto/leave.dto';

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

  @Get('balance')
  @ApiOperation({ summary: 'My quota for a year (created on first read)' })
  balance(@Query() q: LeaveBalanceQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.leave.myBalance(user, q.year);
  }

  @Post()
  @ApiOperation({ summary: 'Apply for leave' })
  submit(@Body() dto: SubmitLeaveDto, @CurrentUser() user: AuthenticatedUser) {
    return this.leave.submit(user, dto);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Withdraw my application while it is still pending' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
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
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'Leave applications (depot-scoped for depot roles)' })
  list(@Query() q: ListLeaveDto, @CurrentUser() user: AuthenticatedUser) {
    return this.leave.listForApproval(user, q);
  }

  @Post('balances/import')
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({
    summary: 'Bulk-import opening leave balances from the CSV wizard',
    description:
      'Carries quota and days-already-taken over from a previous system. An existing year is overwritten and reported as updated.',
  })
  importBalances(@Body() dto: ImportLeaveBalancesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.leave.importBalances(user, dto.rows);
  }

  @Patch(':id/manager-decision')
  @Roles(...CAPABILITIES.leaveApprove)
  @ApiOperation({ summary: 'Stage 1: the manager approves or rejects' })
  manager(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideLeaveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leave.decideManager(user, id, dto.approve, dto.note);
  }

  @Patch(':id/hr-decision')
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Stage 2: HR approves (writes the LEAVE attendance rows) or rejects' })
  hr(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideLeaveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leave.decideHr(user, id, dto.approve, dto.note);
  }
}
