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
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, ImportSummary, InternalAuthGuard, Public } from '@hydromart/platform';

import { EmployeeService } from '../application/services/employee.service';
import {
  AnonymiseEmployeeDto,
  CreateEmployeeDto,
  ImportEmployeesDto,
  ListEmployeesDto,
  ProvisionEmployeeDto,
  ProvisionEmployeesDto,
  RetentionReportDto,
  SetEmployeeActiveDto,
  SetEmployeeDepotDto,
  UpdateEmployeeDto,
} from './dto/employee.dto';
import { Employee, EmploymentHistory } from '../../prisma/generated/client';
import { AnonymiseByAccountResponseDto, EmployeeResponseDto, EmploymentHistoryResponseDto, ImportResponseDto, List6ResponseDto, ProvisionMany2ResponseDto, RetentionAnonymise2ResponseDto, RetentionReport2ResponseDto, SetActive2ResponseDto } from './dto/responses.generated.dto';

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
  @ApiOkResponse({ type: RetentionReport2ResponseDto })
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

  @ApiOkResponse({ type: RetentionAnonymise2ResponseDto })
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

  @ApiOkResponse({ type: RetentionAnonymise2ResponseDto })
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
  @ApiOkResponse({ type: EmployeeResponseDto })
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
   * The same thing for a whole spreadsheet (K-4). One call instead of one per row: the
   * bulk staff import used to make 500 sequential HTTP hops inside a single request.
   *
   * Per-row verdicts come back rather than one status, because auth-service has already
   * created those accounts and has to report which rows are still missing their half.
   */
  @ApiOkResponse({ type: ProvisionMany2ResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/provision-many')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create (or return) the employee rows behind a file of invites' })
  provisionManyFromInvite(
    @Body() dto: ProvisionEmployeesDto,
  ): Promise<{ results: { index: number; ok: boolean; message: string | null }[] }> {
    return this.employees.provisionManyFromInvite(dto.rows);
  }

  /**
   * auth-service reporting that a staff login was switched off or back on in the console.
   *
   * Writes only — see EmployeeService.setActiveInternal for why it must not answer back.
   */
  @ApiOkResponse({ type: SetActive2ResponseDto })
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
   * auth-service reporting that a staff account was moved to another depot in the console.
   *
   * Writes only — see EmployeeService.setDepotInternal for why it must not answer back.
   * Reuses SetActive2ResponseDto: the shape is the same `{updated}` verdict, and minting a
   * second identical class would only add a name.
   */
  @ApiOkResponse({ type: SetActive2ResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/depot')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mirror a console depot transfer onto the employee record' })
  setDepot(@Body() dto: SetEmployeeDepotDto): Promise<{ updated: boolean }> {
    return this.employees.setDepotInternal(dto.authSubjectId, dto.depotId ?? null);
  }

  /**
   * HQ deleted a staff account: scrub the employee record behind it. Same split as the
   * retention sweep — see EmployeePrismaRepository.anonymiseByAuthSubjectId.
   */
  @ApiOkResponse({ type: AnonymiseByAccountResponseDto })
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
  @ApiOkResponse({ type: EmployeeResponseDto })
  @Post(':id/account')
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Create the login account for an employee that has none' })
  createAccount(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.employees.createAccountFor(user, id);
  }

  @ApiOkResponse({ type: List6ResponseDto })
  @Get()
  @Can('hrView')
  @ApiOperation({ summary: 'List employees (depot-scoped for depot roles)' })
  list(@Query() query: ListEmployeesDto, @CurrentUser() user: AuthenticatedUser): Promise<{ rows: Employee[]; total: number; page: number; pageSize: number }> {
    return this.employees.list(user, query);
  }

  @ApiOkResponse({ type: EmployeeResponseDto })
  @Get(':id')
  @Can('hrView')
  @ApiOperation({ summary: 'Get one employee' })
  getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser): Promise<Employee> {
    return this.employees.getById(user, id);
  }

  @ApiOkResponse({ type: EmploymentHistoryResponseDto, isArray: true })
  @Get(':id/history')
  @Can('hrView')
  @ApiOperation({ summary: 'Employment change log for one employee' })
  getHistory(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser): Promise<EmploymentHistory[]> {
    return this.employees.getHistory(user, id);
  }

  @ApiOkResponse({ type: EmployeeResponseDto })
  @Post()
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Create an employee (auto-assigns HR-#### code)' })
  create(@Body() dto: CreateEmployeeDto, @CurrentUser() user: AuthenticatedUser): Promise<Employee> {
    return this.employees.create(user, dto);
  }

  @ApiOkResponse({ type: ImportResponseDto })
  @Post('import')
  @Can('hrAdmin')
  @ApiOperation({
    summary: 'Bulk-import employees from the CSV wizard (provisions a login per row)',
    description:
      'mode=CREATE (default) reports an existing person as skipped; mode=UPSERT overwrites their HR data — their login role is never touched either way.',
  })
  import(@Body() dto: ImportEmployeesDto, @CurrentUser() user: AuthenticatedUser): Promise<ImportSummary> {
    return this.employees.importMany(user, dto.rows, dto.mode ?? 'CREATE');
  }

  @ApiOkResponse({ type: EmployeeResponseDto })
  @Patch(':id')
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Update an employee (logs tracked-field changes to history)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Employee> {
    return this.employees.update(user, id, dto);
  }
}
