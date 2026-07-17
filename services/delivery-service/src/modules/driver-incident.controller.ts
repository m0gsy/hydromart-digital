import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Role, Roles } from '@hydromart/platform';

import { IncidentService } from '../application/services/incident.service';
import { IncidentDto, ReportIncidentDto } from './dto/incident.dto';

/** Courier field incident reporting (design 4b). A courier only sees their own. */
@ApiTags('Driver Incidents')
@ApiBearerAuth()
@Roles(Role.DRIVER)
@Controller({ path: 'driver/incidents', version: '1' })
export class DriverIncidentController {
  constructor(private readonly incidents: IncidentService) {}

  @Post()
  @ApiOperation({ summary: 'Report a field incident; HIGH severity alerts ops (4b)' })
  @ApiOkResponse({ type: IncidentDto })
  async report(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReportIncidentDto,
  ): Promise<IncidentDto> {
    const record = await this.incidents.report(user.sub, dto);
    return IncidentDto.from(record);
  }

  @Get()
  @ApiOperation({ summary: "List the current courier's reported incidents" })
  @ApiOkResponse({ type: IncidentDto, isArray: true })
  async list(@CurrentUser() user: AuthenticatedUser): Promise<IncidentDto[]> {
    const records = await this.incidents.listForDriver(user.sub);
    return records.map((r) => IncidentDto.from(r));
  }
}
