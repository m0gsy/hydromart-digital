import {
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';

import { rolesFor } from '@hydromart/access';
import { Can, ExternalAccess } from '@hydromart/platform';

import { AccessMatrixService } from '../../application/services/access-matrix.service';
import { AccountService } from '../../application/services/account.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user';

/** At most this many people are answered: a picker, not a directory. */
export const PIC_CANDIDATES_MAX = 500;

class PicCandidateDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() fullName!: string;
}

class PicCandidatesResponseDto {
  @ApiProperty({ type: PicCandidateDto, isArray: true }) people!: PicCandidateDto[];
}

/** Only the AI web's token is let in: a staff session has its own screens. */
@Injectable()
export class AiTokenOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (user?.via !== 'ai') throw new ForbiddenException('Only the AI web token may read this.');
    return true;
  }
}

/**
 * HD-21 section 6: who the AI web's CRM may name as a PIC (person in charge): the active staff
 * whose role holds `prospectCrm` right now. Names only.
 */
@ApiTags('AI CRM')
@ApiBearerAuth()
@UseGuards(AiTokenOnlyGuard)
@Controller({ path: 'ai/crm', version: '1' })
export class AiCrmController {
  constructor(
    private readonly accounts: AccountService,
    private readonly matrix: AccessMatrixService,
  ) {}

  @ApiOkResponse({ type: PicCandidatesResponseDto })
  @ExternalAccess('ai')
  @Can('prospectRead')
  @Get('pic-candidates')
  @ApiOperation({ summary: 'AI web CRM: active staff who hold prospectCrm, id and name only (HD-21)' })
  async picCandidates(): Promise<{ people: { id: string; fullName: string }[] }> {
    // The live matrix of this process: built-in defaults, the SUPER_ADMIN's overrides and the custom
    // roles. `snapshot` reloads it when it is older than a few seconds, so an edit shows here at once.
    await this.matrix.snapshot();
    const roles = ['SUPER_ADMIN', ...rolesFor('prospectCrm')];
    return { people: await this.accounts.staffNamesByRoles(roles, PIC_CANDIDATES_MAX) };
  }
}
