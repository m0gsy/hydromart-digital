import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { CAPABILITIES } from '@hydromart/access';
import {
  AuthenticatedUser,
  CurrentUser,
  InternalAuthGuard,
  Public,
  Roles,
} from '@hydromart/platform';

import { EmployeeService } from '../application/services/employee.service';
import {
  CreateEmployeeDto,
  ImportEmployeesDto,
  ListEmployeesDto,
  RetentionReportDto,
  UpdateEmployeeDto,
} from './dto/employee.dto';

/** Employee directory (M1). Read = hrView (incl. depot manager, depot-scoped); write = hrAdmin. */
@ApiTags('HR Employees')
@ApiBearerAuth()
@Controller({ path: 'employees', version: '1' })
export class EmployeesController {
  constructor(private readonly employees: EmployeeService) {}

  /**
   * Retention report for admin-service's purge engine. Internal key, not a JWT route:
   * @Public() bypasses the global JWT guard and InternalAuthGuard is the sole auth.
   * Counts only — see EmployeeService.retentionReport for why nothing is deleted here.
   */
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/retention-report')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Count departed employee records past the cutoff (internal, no deletion)' })
  retentionReport(@Body() dto: RetentionReportDto): Promise<{ eligible: number }> {
    return this.employees.retentionReport(new Date(dto.cutoff));
  }

  @Get()
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'List employees (depot-scoped for depot roles)' })
  list(@Query() query: ListEmployeesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.employees.list(user, query);
  }

  @Get(':id')
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'Get one employee' })
  getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.employees.getById(user, id);
  }

  @Get(':id/history')
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'Employment change log for one employee' })
  getHistory(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.employees.getHistory(user, id);
  }

  @Post()
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Create an employee (auto-assigns HR-#### code)' })
  create(@Body() dto: CreateEmployeeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.employees.create(user, dto);
  }

  @Post('import')
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({
    summary: 'Bulk-import employees from the CSV wizard (provisions a login per row)',
  })
  import(@Body() dto: ImportEmployeesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.employees.importMany(user, dto.rows);
  }

  @Patch(':id')
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Update an employee (logs tracked-field changes to history)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.employees.update(user, id, dto);
  }
}
