import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuditMutationsInterceptor, Can } from '@hydromart/platform';

import { IncidentService } from '../application/services/incident.service';
import {
  CreateIncidentDto,
  IncidentDto,
  IncidentQueryDto,
  PatchIncidentDto,
} from './dto/incident.dto';

// Design 14c — incident timeline. HEAD_OFFICE + SUPER_ADMIN. List (newest-first, filter
// status) + create + patch (append a timeline update / resolve). Updates live in the child
// incident_updates rows.
@ApiTags('Incidents')
@ApiBearerAuth()
@Can('hqBackOffice')
// CA-2-67: every write below reaches the audit trail. See AuditMutationsInterceptor.
@UseInterceptors(AuditMutationsInterceptor)
@Controller({ path: 'incidents', version: '1' })
export class IncidentsController {
  constructor(private readonly incidents: IncidentService) {}

  @ApiOkResponse({ type: IncidentDto, isArray: true })
  @Get()
  @ApiOperation({ summary: 'List incidents (14c, newest first, filterable by status)' })
  async list(@Query() query: IncidentQueryDto): Promise<IncidentDto[]> {
    const rows = await this.incidents.list({ status: query.status });
    return rows.map(IncidentDto.from);
  }

  @ApiOkResponse({ type: IncidentDto })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Open an incident' })
  async create(@Body() dto: CreateIncidentDto): Promise<IncidentDto> {
    return IncidentDto.from(
      await this.incidents.create({
        title: dto.title,
        severity: dto.severity,
        affectedService: dto.affectedService,
        note: dto.note ?? null,
      }),
    );
  }

  @ApiOkResponse({ type: IncidentDto })
  @Patch(':id')
  @ApiOperation({ summary: 'Append a timeline update and/or resolve an incident' })
  async patch(@Param('id') id: string, @Body() dto: PatchIncidentDto): Promise<IncidentDto> {
    return IncidentDto.from(await this.incidents.patch(id, { note: dto.note, status: dto.status }));
  }
}
