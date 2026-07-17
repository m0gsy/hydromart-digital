import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import { SlaPolicyService } from '../application/services/sla-policy.service';
import { SaveSlaPolicyDto, SlaPolicyDto } from './dto/sla-policy.dto';

// Design 19d — on-time SLA policy (singleton). HEAD_OFFICE + SUPER_ADMIN, read and write.
// NOTE: delivery-service still grades on-time delivery with its OWN threshold; it does not
// yet read this policy (cross-service wiring is a later change, not done here).
@ApiTags('SLA policy')
@ApiBearerAuth()
@Roles(Role.HEAD_OFFICE, Role.SUPER_ADMIN)
@Controller({ path: 'sla-policy', version: '1' })
export class SlaPolicyController {
  constructor(private readonly policy: SlaPolicyService) {}

  @Get()
  @ApiOperation({ summary: 'Read the SLA policy (threshold + healthy/critical bands)' })
  async get(): Promise<SlaPolicyDto> {
    return SlaPolicyDto.from(await this.policy.get());
  }

  @Put()
  @ApiOperation({ summary: 'Replace the SLA policy' })
  async save(@Body() dto: SaveSlaPolicyDto): Promise<SlaPolicyDto> {
    return SlaPolicyDto.from(await this.policy.save(dto));
  }
}
