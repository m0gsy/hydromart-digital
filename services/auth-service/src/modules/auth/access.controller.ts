import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { AuditMutationsInterceptor, Can } from '@hydromart/platform';

import {
  AccessMatrixService,
  AccessMatrixView,
  AccessSnapshot,
} from '../../application/services/access-matrix.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { InternalAuthGuard } from '../../common/guards/internal-auth.guard';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user';
import {
  AccessMatrixResponseDto,
  InternalOverrides3ResponseDto,
} from '../dto/responses.generated.dto';

export class SetCapabilityRolesDto {
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  roles!: string[];
}

export class CapabilityChangeDto {
  @IsString()
  @MaxLength(64)
  capability!: string;

  /** `null` resets the capability to its compiled default. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  roles!: string[] | null;
}

export class UpdateBuiltInRoleDto {
  /**
   * The `updatedAt` of the role's settings row as the form saw it, or absent when the role had no
   * settings yet (nothing to overwrite). Refused when the row has moved since.
   */
  @IsOptional()
  @IsString()
  seenUpdatedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string | null;

  /** `null` returns the role to its compiled reach. */
  @IsOptional()
  @IsIn(['LOCKED', 'RESOLVED', 'GLOBAL'])
  scope?: string | null;
}

export class SetBuiltInDisabledDto {
  @IsBoolean()
  disabled!: boolean;
}

export class CreateCustomRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @IsOptional()
  @IsIn(['LOCKED', 'RESOLVED', 'GLOBAL'])
  scope?: string;

  /** A built-in role to start from: its capabilities (minus the forbidden ones) and its reach. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  copyFrom?: string;
}

export class UpdateCustomRoleDto {
  /** The `updatedAt` the form was shown; the write is refused if the role has moved since. */
  @IsString()
  seenUpdatedAt!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @IsOptional()
  @IsIn(['LOCKED', 'RESOLVED', 'GLOBAL'])
  scope?: string;
}

export class SetDepotOverrideDto {
  @IsIn(['GRANT', 'DENY'])
  effect!: string;
}

export class ApplyMatrixDto {
  @IsArray()
  @ArrayMaxSize(256)
  @ValidateNested({ each: true })
  @Type(() => CapabilityChangeDto)
  changes!: CapabilityChangeDto[];
}

/**
 * The RBAC matrix as data: read it, retune it, reset it.
 *
 * Writes land in a sparse override table and every service picks them up on its next
 * poll (bounded staleness of one TTL, ~30s), so a policy change no longer needs a
 * deploy. The capability NAME is validated against the compiled map before it is
 * stored — this is a trust boundary, not a free-form key/value store.
 */
@ApiTags('Access')
@ApiBearerAuth()
// CA-2-67: role and capability changes reach the audit trail.
@UseInterceptors(AuditMutationsInterceptor)
@Controller({ path: 'access', version: '1' })
export class AccessController {
  constructor(private readonly matrix: AccessMatrixService) {}

  // Read is staffAdmin, not accessMatrixWrite: head office may see who can do what
  // without being able to change it.
  @ApiOkResponse({ type: AccessMatrixResponseDto })
  @Can('staffAdmin')
  @Get('matrix')
  @ApiOperation({
    summary: 'Compiled defaults, the super-admin overrides, and the effective matrix',
  })
  view(): Promise<AccessMatrixView> {
    return this.matrix.view();
  }

  /*
   * The whole screenful at once, in one transaction.
   *
   * The editor used to send one request per changed capability in a loop. A failure on
   * the fourth of seven left three edits enforced and four not, while the screen still
   * showed all seven as unsaved — and its "Reset" button only put the local grid back,
   * so the operator's way out of a half-applied matrix silently changed nothing on the
   * server. Validation now runs over every change before the first write.
   */
  @ApiOkResponse({ description: 'No content.' })
  @Can('accessMatrixWrite')
  @Put('matrix')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Apply every changed capability as one transaction' })
  async applyAll(
    @Body() dto: ApplyMatrixDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.matrix.applyAll(
      dto.changes.map((c) => ({ capability: c.capability, roles: c.roles ?? null })),
      user.sub,
    );
  }

  @ApiOkResponse({ description: 'No content.' })
  @Can('accessMatrixWrite')
  @Put('matrix/:capability')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Replace the role list for one capability' })
  async set(
    @Param('capability') capability: string,
    @Body() dto: SetCapabilityRolesDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.matrix.set(capability, dto.roles, user.sub);
  }

  @ApiOkResponse({ description: 'No content.' })
  @Can('accessMatrixWrite')
  @Delete('matrix/:capability')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Drop one capability override, back to the compiled default' })
  async reset(
    @Param('capability') capability: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.matrix.reset(capability, user.sub);
  }

  // Custom roles. Read is staffAdmin so the staff console can offer them; writes are
  // accessMatrixWrite, and only SUPER_ADMIN holds that.
  @ApiOkResponse({ description: 'Every custom role, archived ones included.' })
  @Can('staffAdmin')
  @Get('roles')
  @ApiOperation({ summary: 'List custom roles' })
  listRoles(): Promise<unknown> {
    return this.matrix.listRoles();
  }

  @ApiOkResponse({ description: 'The created role.' })
  @Can('accessMatrixWrite')
  @Post('roles')
  @ApiOperation({ summary: 'Create a custom role' })
  createRole(@Body() dto: CreateCustomRoleDto, @CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.matrix.createRole(dto, user.sub);
  }

  @ApiOkResponse({ description: 'The updated role.' })
  @Can('accessMatrixWrite')
  @Put('roles/:key')
  @ApiOperation({ summary: 'Rename a custom role or change its scope' })
  updateRole(
    @Param('key') key: string,
    @Body() dto: UpdateCustomRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<unknown> {
    return this.matrix.updateRole(key, dto, user.sub);
  }

  @ApiOkResponse({ description: 'No content.' })
  @Can('accessMatrixWrite')
  @Delete('roles/:key')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Archive a custom role (refused while an account holds it)' })
  async archiveRole(@Param('key') key: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.matrix.archiveRole(key, user.sub);
  }

  // Built-in roles: rename / describe / rescope, and switch off or on.
  @ApiOkResponse({ description: 'No content.' })
  @Can('accessMatrixWrite')
  @Put('builtin/:role')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Name, description and depot reach of a built-in role' })
  async updateBuiltIn(
    @Param('role') role: string,
    @Body() dto: UpdateBuiltInRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.matrix.updateBuiltInRole(role, dto, user.sub);
  }

  @ApiOkResponse({ description: 'No content.' })
  @Can('accessMatrixWrite')
  @Put('builtin/:role/disabled')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Switch a built-in role off or back on (refused while accounts hold it)' })
  async setBuiltInDisabled(
    @Param('role') role: string,
    @Body() dto: SetBuiltInDisabledDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.matrix.setBuiltInDisabled(role, dto.disabled, user.sub);
  }

  // Per-depot exceptions to the matrix.
  @ApiOkResponse({ description: 'No content.' })
  @Can('accessMatrixWrite')
  @Put('matrix/:capability/depots/:depotId/:roleKey')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Grant or deny a capability for one role at one depot' })
  async setDepotOverride(
    @Param('capability') capability: string,
    @Param('depotId', new ParseUUIDPipe()) depotId: string,
    @Param('roleKey') roleKey: string,
    @Body() dto: SetDepotOverrideDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.matrix.setDepotOverride(capability, roleKey, depotId, dto.effect, user.sub);
  }

  @ApiOkResponse({ description: 'No content.' })
  @Can('accessMatrixWrite')
  @Delete('matrix/:capability/depots/:depotId/:roleKey')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Drop one per-depot exception' })
  async resetDepotOverride(
    @Param('capability') capability: string,
    @Param('depotId', new ParseUUIDPipe()) depotId: string,
    @Param('roleKey') roleKey: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.matrix.resetDepotOverride(capability, roleKey, depotId, user.sub);
  }

  // What the other services poll. Internal key auth, not a user token: it is read by
  // machines on a timer, and it carries policy rather than anyone's data.
  @ApiOkResponse({ type: InternalOverrides3ResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/overrides')
  @ApiOperation({ summary: 'Capability overrides for the service-side matrix cache' })
  internalOverrides(): Promise<AccessSnapshot> {
    return this.matrix.snapshot();
  }
}
