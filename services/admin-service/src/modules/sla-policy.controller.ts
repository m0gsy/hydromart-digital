import { Body, Controller, Get, Put, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuditMutationsInterceptor, Can } from '@hydromart/platform';

import { SlaPolicyService } from '../application/services/sla-policy.service';
import { SaveSlaPolicyDto, SlaBandsDto, SlaPolicyDto } from './dto/sla-policy.dto';

// Design 19d — on-time SLA policy (singleton). HEAD_OFFICE + SUPER_ADMIN, read and write.
// HD-6: delivery-service reads the threshold from here (internal key) when a depot has no
// threshold of its own, and stores the on-time verdict when a delivery completes.
@ApiTags('SLA policy')
@ApiBearerAuth()
@Can('hqBackOffice')
// CA-2-67: every write below reaches the audit trail. See AuditMutationsInterceptor.
@UseInterceptors(AuditMutationsInterceptor)
@Controller({ path: 'sla-policy', version: '1' })
export class SlaPolicyController {
  constructor(private readonly policy: SlaPolicyService) {}

  @ApiOkResponse({ type: SlaPolicyDto })
  @Get()
  @ApiOperation({ summary: 'Read the SLA policy (threshold + healthy/critical bands)' })
  async get(): Promise<SlaPolicyDto> {
    return SlaPolicyDto.from(await this.policy.get());
  }

  /**
   * HD-6 #19: only the colour bands, for every screen that colours an SLA percentage. The
   * policy itself stays HQ-only; the bands are not sensitive and the dashboard roles need them.
   */
  @ApiOkResponse({ type: SlaBandsDto })
  @Can('dashboard')
  @Get('bands')
  @ApiOperation({ summary: 'Read the SLA colour bands (healthy / critical %)' })
  async bands(): Promise<SlaBandsDto> {
    return SlaBandsDto.from(await this.policy.get());
  }

  @ApiOkResponse({ type: SlaPolicyDto })
  @Put()
  @ApiOperation({ summary: 'Replace the SLA policy' })
  async save(@Body() dto: SaveSlaPolicyDto): Promise<SlaPolicyDto> {
    return SlaPolicyDto.from(await this.policy.save(dto, dto.seenUpdatedAt));
  }
}
