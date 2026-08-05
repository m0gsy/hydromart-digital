import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, ImportSummary } from '@hydromart/platform';

import { AllowanceService } from '../application/services/allowance.service';
import { CreateAllowanceDto, ImportAllowancesDto, ListAllowanceDto } from './dto/allowance.dto';
import { Allowance } from '../../prisma/generated/client';
import { AllowanceResponseDto, ImportResponseDto } from './dto/responses.generated.dto';

/** Recurring pay components. Read hrView, write hrPayroll (it is salary, not master data). */
@ApiTags('HR Allowances')
@ApiBearerAuth()
@Controller({ path: 'allowances', version: '1' })
export class AllowanceController {
  constructor(private readonly allowances: AllowanceService) {}

  @ApiOkResponse({ type: AllowanceResponseDto, isArray: true })
  @Get()
  @Can('hrView')
  @ApiOperation({ summary: 'List an employee’s allowances (active first)' })
  list(@Query() q: ListAllowanceDto, @CurrentUser() user: AuthenticatedUser): Promise<Allowance[]> {
    return this.allowances.list(user, q.employeeId);
  }

  @ApiOkResponse({ type: AllowanceResponseDto })
  @Post()
  @Can('hrPayroll')
  @ApiOperation({ summary: 'Add a recurring allowance' })
  create(@Body() dto: CreateAllowanceDto, @CurrentUser() user: AuthenticatedUser): Promise<Allowance> {
    return this.allowances.add(user, dto);
  }

  @ApiOkResponse({ type: ImportResponseDto })
  @Post('import')
  @Can('hrPayroll')
  @ApiOperation({ summary: 'Bulk-import recurring allowances from the CSV wizard' })
  import(@Body() dto: ImportAllowancesDto, @CurrentUser() user: AuthenticatedUser): Promise<ImportSummary> {
    return this.allowances.importMany(user, dto.rows);
  }

  @ApiOkResponse({ type: AllowanceResponseDto })
  @Patch(':id/deactivate')
  @Can('hrPayroll')
  @ApiOperation({ summary: 'Stop an allowance (kept for payslip history)' })
  deactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser): Promise<Allowance> {
    return this.allowances.deactivate(user, id);
  }
}
