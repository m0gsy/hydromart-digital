import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser } from '@hydromart/platform';

import { EmployeeDepotAssignment } from '../../prisma/generated/client';
import { DepotAssignmentService } from '../application/services/depot-assignment.service';
import {
  DepotAssignmentResponseDto,
  ListDepotAssignmentDto,
  PagedDepotAssignmentResponseDto,
  PlanDepotAssignmentDto,
} from './dto/depot-assignment.dto';

/**
 * Cross-depot assignments. `employeeAssign` is HR and head office only - see the reason on
 * the capability: a depot-scoped holder could pull another depot's staff.
 */
@ApiTags('HR Penugasan Depot')
@ApiBearerAuth()
@Controller({ path: 'depot-assignments', version: '1' })
export class DepotAssignmentController {
  constructor(private readonly assignments: DepotAssignmentService) {}

  @ApiOkResponse({ type: PagedDepotAssignmentResponseDto })
  @Can('employeeAssign')
  @Get()
  @ApiOperation({ summary: 'Cross-depot assignments, newest start first' })
  list(@Query() q: ListDepotAssignmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.assignments.list(user, q);
  }

  @ApiOkResponse({ type: DepotAssignmentResponseDto })
  @Can('employeeAssign')
  @Post()
  @ApiOperation({ summary: 'Plan a loan to another depot, or schedule a permanent move' })
  plan(
    @Body() dto: PlanDepotAssignmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EmployeeDepotAssignment> {
    return this.assignments.plan(user, dto);
  }

  @ApiOkResponse({ type: DepotAssignmentResponseDto })
  @Can('employeeAssign')
  @Post(':id/apply-now')
  @HttpCode(200)
  @ApiOperation({ summary: 'Apply a due assignment now instead of waiting for the next sweep' })
  applyNow(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EmployeeDepotAssignment> {
    return this.assignments.applyNow(user, id);
  }

  @ApiOkResponse({ type: DepotAssignmentResponseDto })
  @Can('employeeAssign')
  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel an assignment that has not started yet' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EmployeeDepotAssignment> {
    return this.assignments.cancel(user, id);
  }
}
