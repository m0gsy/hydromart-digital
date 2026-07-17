import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, AuthenticatedUser, Roles } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { IncidentService } from '../application/services/incident.service';
import { Incident } from '../domain/incident';
import { CreateIncidentDto, ListIncidentQueryDto, ResolveIncidentDto } from './dto/incident.dto';

/** Depot operational incidents inbox (design 6b operator + 13b manager). */
@ApiTags('Incidents')
@ApiBearerAuth()
@Roles(...CAPABILITIES.incidents)
@Controller({ path: 'incidents', version: '1' })
export class IncidentController {
  constructor(private readonly incidents: IncidentService) {}

  @Post()
  @ApiOperation({ summary: 'Record a depot incident' })
  record(@Body() dto: CreateIncidentDto, @CurrentUser() user: AuthenticatedUser): Promise<Incident> {
    return this.incidents.record(
      {
        depotId: dto.depotId,
        type: dto.type,
        severity: dto.severity,
        title: dto.title,
        description: dto.description ?? null,
        courierName: dto.courierName ?? null,
        orderRef: dto.orderRef ?? null,
      },
      user.sub,
    );
  }

  @Get()
  @ApiOperation({ summary: "List a depot's incidents (newest first), optional status filter" })
  list(@Query() query: ListIncidentQueryDto): Promise<Incident[]> {
    return this.incidents.list(query.depotId, { status: query.status });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one incident' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Incident> {
    return this.incidents.get(id);
  }

  @Patch(':id/resolve')
  @ApiOperation({ summary: 'Resolve an incident with a resolution note' })
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveIncidentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Incident> {
    return this.incidents.resolve(id, dto.note, user.sub);
  }
}
