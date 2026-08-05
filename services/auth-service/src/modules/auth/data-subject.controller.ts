import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { DataSubjectService, DataExport } from '../../application/services/data-subject.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Can, Roles } from '@hydromart/platform';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user';
import { Role } from '../../domain/customer/role.enum';
import {
  CreateDataSubjectRequestDto,
  DataSubjectRequestDto,
  RejectDataSubjectRequestDto,
} from './dto/data-subject.dto';
import { Approve3ResponseDto, DataExportResponseDto } from '../dto/responses.generated.dto';

/**
 * UU PDP tahap 1 (item 13). Customers raise requests; HEAD OFFICE decides them.
 *
 * Nothing here executes on the customer's click — see DataSubjectService for why an
 * automatic delete button is a hijacked account's best weapon.
 */
@ApiTags('PDP')
@ApiBearerAuth()
@Controller({ path: 'account/data-requests', version: '1' })
export class DataSubjectController {
  constructor(private readonly requests: DataSubjectService) {}

  @ApiOkResponse({ type: DataSubjectRequestDto })
  @Roles(Role.CUSTOMER)
  @Post()
  @ApiOperation({ summary: 'Ask for a copy of your data, or for your account to be deleted' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDataSubjectRequestDto,
  ): Promise<DataSubjectRequestDto> {
    return DataSubjectRequestDto.from(
      await this.requests.request(user.sub, dto.type, dto.reason ?? null),
    );
  }

  @ApiOkResponse({ type: DataSubjectRequestDto, isArray: true })
  @Roles(Role.CUSTOMER)
  @Get('me')
  @ApiOperation({ summary: 'Your own requests and where each one stands' })
  async mine(@CurrentUser() user: AuthenticatedUser): Promise<DataSubjectRequestDto[]> {
    const rows = await this.requests.listMine(user.sub);
    return rows.map((r) => DataSubjectRequestDto.from(r));
  }

  @ApiOkResponse({ type: DataExportResponseDto })
  @Roles(Role.CUSTOMER)
  @Get('me/export')
  @ApiOperation({
    summary: 'Download your data as JSON',
    description:
      'Built on request rather than stored: a saved copy of everything we hold about a person is a second copy to leak.',
  })
  export(@CurrentUser() user: AuthenticatedUser): Promise<DataExport> {
    return this.requests.exportFor(user.sub);
  }

  @ApiOkResponse({ type: DataSubjectRequestDto, isArray: true })
  @Can('pdpRequests')
  @Get()
  @ApiOperation({ summary: 'The PDP queue — pending first, longest wait first' })
  async queue(@Query('status') status?: string): Promise<DataSubjectRequestDto[]> {
    const rows = await this.requests.listForStaff(
      status === 'PENDING' || status === 'COMPLETED' || status === 'REJECTED' ? status : undefined,
    );
    return rows.map((r) => DataSubjectRequestDto.from(r));
  }

  @ApiOkResponse({ type: Approve3ResponseDto })
  @Can('pdpRequests')
  @Post(':id/approve')
  @ApiOperation({
    summary: 'Grant the request',
    description:
      'EXPORT returns the payload. DELETE anonymises the account: identifiers destroyed, financial rows kept without an owner (item 12).',
  })
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ request: DataSubjectRequestDto; export?: DataExport }> {
    const result = await this.requests.approve(id, user.sub);
    return {
      request: DataSubjectRequestDto.from(result.request),
      ...(result.export ? { export: result.export } : {}),
    };
  }

  @ApiOkResponse({ type: DataSubjectRequestDto })
  @Can('pdpRequests')
  @Post(':id/reject')
  @ApiOperation({ summary: 'Refuse the request, with a reason the customer can read' })
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDataSubjectRequestDto,
  ): Promise<DataSubjectRequestDto> {
    return DataSubjectRequestDto.from(await this.requests.reject(id, user.sub, dto.reason));
  }
}
