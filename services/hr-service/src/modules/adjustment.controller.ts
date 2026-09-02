import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, ImportSummary } from '@hydromart/platform';

import { AdjustmentService } from '../application/services/adjustment.service';
import {
  AdjustmentQueryDto,
  CreateBonusDto,
  CreateDeductionDto,
  ImportDeductionsDto,
} from './dto/payroll.dto';
import { Bonus, Deduction } from '../../prisma/generated/client';
import { BonusResponseDto, DeductionResponseDto, ImportResponseDto } from './dto/responses.generated.dto';

@ApiTags('HR Bonuses')
@ApiBearerAuth()
@Controller({ path: 'bonuses', version: '1' })
export class BonusController {
  constructor(private readonly adjustments: AdjustmentService) {}

  @ApiOkResponse({ type: BonusResponseDto, isArray: true })
  @Get()
  @Can('hrView')
  @ApiOperation({ summary: 'List an employee’s bonuses for a period' })
  list(@Query() q: AdjustmentQueryDto, @CurrentUser() user: AuthenticatedUser): Promise<Bonus[]> {
    return this.adjustments.listBonuses(user, q.employeeId, q.periodMonth);
  }

  @ApiOkResponse({ type: BonusResponseDto })
  @Post()
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Add a bonus' })
  create(@Body() dto: CreateBonusDto, @CurrentUser() user: AuthenticatedUser): Promise<Bonus> {
    return this.adjustments.addBonus(user, dto);
  }

  @ApiOkResponse({ description: 'No content.' })
  @Delete(':id')
  @HttpCode(204)
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Delete a bonus typed by mistake (period must still be DRAFT)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.adjustments.removeBonus(user, id);
  }
}

@ApiTags('HR Deductions')
@ApiBearerAuth()
@Controller({ path: 'deductions', version: '1' })
export class DeductionController {
  constructor(private readonly adjustments: AdjustmentService) {}

  @ApiOkResponse({ type: DeductionResponseDto, isArray: true })
  @Get()
  @Can('hrView')
  @ApiOperation({ summary: 'List an employee’s deductions for a period' })
  list(@Query() q: AdjustmentQueryDto, @CurrentUser() user: AuthenticatedUser): Promise<Deduction[]> {
    return this.adjustments.listDeductions(user, q.employeeId, q.periodMonth);
  }

  @ApiOkResponse({ type: DeductionResponseDto })
  @Post()
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Add a deduction' })
  create(@Body() dto: CreateDeductionDto, @CurrentUser() user: AuthenticatedUser): Promise<Deduction> {
    return this.adjustments.addDeduction(user, dto);
  }

  @ApiOkResponse({ type: ImportResponseDto })
  @Post('import')
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Bulk-import deductions from the CSV wizard' })
  import(@Body() dto: ImportDeductionsDto, @CurrentUser() user: AuthenticatedUser): Promise<ImportSummary> {
    return this.adjustments.importDeductions(user, dto.rows);
  }

  @ApiOkResponse({ description: 'No content.' })
  @Delete(':id')
  @HttpCode(204)
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Delete a deduction typed by mistake (period must still be DRAFT)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.adjustments.removeDeduction(user, id);
  }
}
