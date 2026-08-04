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
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, AuthenticatedUser, CurrentUser } from '@hydromart/platform';

import { DepartmentService } from '../application/services/department.service';
import { CreateDepartmentDto, ListDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';
import { Department } from '../../prisma/generated/client';
import { DepartmentResponseDto } from './dto/responses.generated.dto';

/** Org units an employee can belong to. Read hrView, write hrAdmin. */
@ApiTags('HR Departments')
@ApiBearerAuth()
@Controller({ path: 'departments', version: '1' })
export class DepartmentController {
  constructor(private readonly departments: DepartmentService) {}

  @ApiOkResponse({ type: DepartmentResponseDto, isArray: true })
  @Get()
  @Can('hrView')
  @ApiOperation({ summary: 'List departments (a depot sees its own plus network-wide ones)' })
  list(@Query() q: ListDepartmentDto, @CurrentUser() user: AuthenticatedUser): Promise<Department[]> {
    return this.departments.list(user, q.depotId);
  }

  @ApiOkResponse({ type: DepartmentResponseDto })
  @Post()
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Create a department (omit depotId for a network-wide one)' })
  create(@Body() dto: CreateDepartmentDto, @CurrentUser() user: AuthenticatedUser): Promise<Department> {
    return this.departments.create(user, dto);
  }

  @ApiOkResponse({ type: DepartmentResponseDto })
  @Patch(':id')
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Update a department' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Department> {
    return this.departments.update(user, id, dto);
  }

  @ApiOkResponse({ description: 'No content.' })
  @Delete(':id')
  @Can('hrAdmin')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a department' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.departments.remove(user, id);
  }
}
