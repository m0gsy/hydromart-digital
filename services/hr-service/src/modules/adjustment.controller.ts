import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CAPABILITIES } from '@hydromart/access';
import { AuthenticatedUser, CurrentUser, Roles } from '@hydromart/platform';

import { AdjustmentService } from '../application/services/adjustment.service';
import { AdjustmentQueryDto, CreateBonusDto, CreateDeductionDto } from './dto/payroll.dto';

@ApiTags('HR Bonuses')
@ApiBearerAuth()
@Controller({ path: 'bonuses', version: '1' })
export class BonusController {
  constructor(private readonly adjustments: AdjustmentService) {}

  @Get()
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'List an employee’s bonuses for a period' })
  list(@Query() q: AdjustmentQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.adjustments.listBonuses(user, q.employeeId, q.periodMonth);
  }

  @Post()
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Add a bonus' })
  create(@Body() dto: CreateBonusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.adjustments.addBonus(user, dto);
  }
}

@ApiTags('HR Deductions')
@ApiBearerAuth()
@Controller({ path: 'deductions', version: '1' })
export class DeductionController {
  constructor(private readonly adjustments: AdjustmentService) {}

  @Get()
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'List an employee’s deductions for a period' })
  list(@Query() q: AdjustmentQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.adjustments.listDeductions(user, q.employeeId, q.periodMonth);
  }

  @Post()
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Add a deduction' })
  create(@Body() dto: CreateDeductionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.adjustments.addDeduction(user, dto);
  }
}
