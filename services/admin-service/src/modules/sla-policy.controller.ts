import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can } from '@hydromart/platform';

import { SlaPolicyService } from '../application/services/sla-policy.service';
import { SaveSlaPolicyDto, SlaPolicyDto } from './dto/sla-policy.dto';

// Design 19d — on-time SLA policy (singleton). HEAD_OFFICE + SUPER_ADMIN, read and write.
// NOTE: delivery-service still grades on-time delivery with its OWN threshold; it does not
// yet read this policy (cross-service wiring is a later change, not done here).
@ApiTags('SLA policy')
@ApiBearerAuth()
@Can('hqConsole')
@Controller({ path: 'sla-policy', version: '1' })
export class SlaPolicyController {
  constructor(private readonly policy: SlaPolicyService) {}

  @ApiOkResponse({ type: SlaPolicyDto })
  @Get()
  @ApiOperation({ summary: 'Read the SLA policy (threshold + healthy/critical bands)' })
  async get(): Promise<SlaPolicyDto> {
    return SlaPolicyDto.from(await this.policy.get());
  }

  @ApiOkResponse({ type: SlaPolicyDto })
  @Put()
  @ApiOperation({ summary: 'Replace the SLA policy' })
  async save(@Body() dto: SaveSlaPolicyDto): Promise<SlaPolicyDto> {
    return SlaPolicyDto.from(await this.policy.save(dto));
  }
}
