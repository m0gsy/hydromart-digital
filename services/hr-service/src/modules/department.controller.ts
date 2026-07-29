import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CAPABILITIES } from '@hydromart/access';
import { AuthenticatedUser, CurrentUser, Roles } from '@hydromart/platform';

import { DepartmentService } from '../application/services/department.service';
import {
  CreateDepartmentDto,
  ListDepartmentDto,
  UpdateDepartmentDto,
} from './dto/department.dto';

/** Org units an employee can belong to. Read hrView, write hrAdmin. */
@ApiTags('HR Departments')
@ApiBearerAuth()
@Controller({ path: 'departments', version: '1' })
export class DepartmentController {
  constructor(private readonly departments: DepartmentService) {}

  @Get()
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'List departments (a depot sees its own plus network-wide ones)' })
  list(@Query() q: ListDepartmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.departments.list(user, q.depotId);
  }

  @Post()
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Create a department (omit depotId for a network-wide one)' })
  create(@Body() dto: CreateDepartmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.departments.create(user, dto);
  }

  @Patch(':id')
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Update a department' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.departments.update(user, id, dto);
  }

  @Delete(':id')
  @Roles(...CAPABILITIES.hrAdmin)
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a department' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.departments.remove(user, id);
  }
}
