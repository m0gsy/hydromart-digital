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

import { Can, AuthenticatedUser, CurrentUser, InternalAuthGuard, Public } from '@hydromart/platform';

import { EmployeeService } from '../application/services/employee.service';
import {
  AnonymiseEmployeeDto,
  CreateEmployeeDto,
  ImportEmployeesDto,
  ListEmployeesDto,
  ProvisionEmployeeDto,
  RetentionReportDto,
  SetEmployeeActiveDto,
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
  @ApiOperation({
    summary: 'Count departed employee records past the cutoff (internal, no deletion)',
  })
  retentionReport(@Body() dto: RetentionReportDto): Promise<{ eligible: number }> {
    return this.employees.retentionReport(new Date(dto.cutoff));
  }

  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/retention-anonymise')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Strip identity from departed employee records past the cutoff (internal)',
    description:
      'Biometrics, attendance and performance reviews are deleted; payroll, bonuses, deductions and loans are kept without an owner (FINANCIAL, 10 years).',
  })
  retentionAnonymise(@Body() dto: RetentionReportDto): Promise<{ deleted: number }> {
    return this.employees.retentionAnonymise(new Date(dto.cutoff));
  }

  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/retention-biometrics')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete face embeddings of departed staff past the cutoff (internal)' })
  purgeBiometrics(@Body() dto: RetentionReportDto): Promise<{ deleted: number }> {
    return this.employees.purgeBiometrics(new Date(dto.cutoff));
  }

  /**
   * The staff console inviting somebody: auth-service has just minted the account and hands
   * it here so HR is not the last to know. Internal key, same shape as the routes above.
   *
   * Idempotent — see EmployeeService.provisionFromInvite. Re-inviting a phone returns the
   * employee that is already there rather than writing a second one.
   */
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/provision')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create (or return) the employee row behind an invited account' })
  provisionFromInvite(@Body() dto: ProvisionEmployeeDto) {
    return this.employees.provisionFromInvite(dto);
  }

  /**
   * auth-service reporting that a staff login was switched off or back on in the console.
   *
   * Writes only — see EmployeeService.setActiveInternal for why it must not answer back.
   */
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mirror a login enable/disable onto the employee record' })
  setActive(@Body() dto: SetEmployeeActiveDto): Promise<{ updated: boolean }> {
    return this.employees.setActiveInternal(dto.authSubjectId, dto.active);
  }

  /**
   * HQ deleted a staff account: scrub the employee record behind it. Same split as the
   * retention sweep — see EmployeePrismaRepository.anonymiseByAuthSubjectId.
   */
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/anonymise')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Strip identity from the employee behind a deleted account' })
  anonymiseByAccount(@Body() dto: AnonymiseEmployeeDto): Promise<{ anonymised: number }> {
    return this.employees.anonymiseByAccount(dto.authSubjectId);
  }

  /**
   * Give an existing employee the login they never had. Backs the reconciliation badge on
   * `/hr/employees`; idempotent, so clicking twice mints one account.
   */
  @Post(':id/account')
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Create the login account for an employee that has none' })
  createAccount(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.employees.createAccountFor(user, id);
  }

  @Get()
  @Can('hrView')
  @ApiOperation({ summary: 'List employees (depot-scoped for depot roles)' })
  list(@Query() query: ListEmployeesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.employees.list(user, query);
  }

  @Get(':id')
  @Can('hrView')
  @ApiOperation({ summary: 'Get one employee' })
  getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.employees.getById(user, id);
  }

  @Get(':id/history')
  @Can('hrView')
  @ApiOperation({ summary: 'Employment change log for one employee' })
  getHistory(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.employees.getHistory(user, id);
  }

  @Post()
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Create an employee (auto-assigns HR-#### code)' })
  create(@Body() dto: CreateEmployeeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.employees.create(user, dto);
  }

  @Post('import')
  @Can('hrAdmin')
  @ApiOperation({
    summary: 'Bulk-import employees from the CSV wizard (provisions a login per row)',
    description:
      'mode=CREATE (default) reports an existing person as skipped; mode=UPSERT overwrites their HR data — their login role is never touched either way.',
  })
  import(@Body() dto: ImportEmployeesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.employees.importMany(user, dto.rows, dto.mode ?? 'CREATE');
  }

  @Patch(':id')
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Update an employee (logs tracked-field changes to history)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.employees.update(user, id, dto);
  }
}
