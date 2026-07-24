import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CAPABILITIES } from '@hydromart/access';
import { AuthenticatedUser, CurrentUser, Roles } from '@hydromart/platform';

import { EmployeeService } from '../application/services/employee.service';
import { CreateEmployeeDto, ListEmployeesDto, UpdateEmployeeDto } from './dto/employee.dto';

/** Employee directory (M1). Read = hrView (incl. depot manager, depot-scoped); write = hrAdmin. */
@ApiTags('HR Employees')
@ApiBearerAuth()
@Controller({ path: 'employees', version: '1' })
export class EmployeesController {
  constructor(private readonly employees: EmployeeService) {}

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
