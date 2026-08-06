import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

import { Can } from '@hydromart/platform';

import { AccessMatrixService, AccessMatrixView } from '../../application/services/access-matrix.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { InternalAuthGuard } from '../../common/guards/internal-auth.guard';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user';
import { AccessMatrixResponseDto, InternalOverrides3ResponseDto } from '../dto/responses.generated.dto';

export class SetCapabilityRolesDto {
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  roles!: string[];
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
@Controller({ path: 'access', version: '1' })
export class AccessController {
  constructor(private readonly matrix: AccessMatrixService) {}

  // Read is staffAdmin, not accessMatrixWrite: head office may see who can do what
  // without being able to change it.
  @ApiOkResponse({ type: AccessMatrixResponseDto })
  @Can('staffAdmin')
  @Get('matrix')
  @ApiOperation({ summary: 'Compiled defaults, the super-admin overrides, and the effective matrix' })
  view(): Promise<AccessMatrixView> {
    return this.matrix.view();
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
  async reset(@Param('capability') capability: string): Promise<void> {
    await this.matrix.reset(capability);
  }

  // What the other services poll. Internal key auth, not a user token: it is read by
  // machines on a timer, and it carries policy rather than anyone's data.
  @ApiOkResponse({ type: InternalOverrides3ResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/overrides')
  @ApiOperation({ summary: 'Capability overrides for the service-side matrix cache' })
  async internalOverrides(): Promise<{ overrides: Record<string, readonly string[]> }> {
    return { overrides: await this.matrix.patch() };
  }
}
