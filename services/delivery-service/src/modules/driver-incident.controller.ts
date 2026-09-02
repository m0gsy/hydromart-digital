import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Role, Roles } from '@hydromart/platform';

import { IncidentService } from '../application/services/incident.service';
import { IncidentDto, ReportIncidentDto } from './dto/incident.dto';

/** Courier field incident reporting (design 4b). A courier only sees their own. */
@ApiTags('Driver Incidents')
@ApiBearerAuth()
@Roles(Role.STAFF_DEPOT)
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
    /*
     * CA-4-46: the depot comes from the courier's own token, not from the body.
     *
     * The app never sent one, so every incident — accidents included — was stored with a
     * null depot, and the HIGH-severity alert that goes to ops carries `depotId` as the
     * only thing saying WHICH depot's courier is in trouble. It went out addressed to
     * nobody. The token already knows: a courier is depot staff and carries their depot in
     * every request. The body field stays as the fallback for the one caller that has a
     * depot the token does not (a courier lent to another depot for a day).
     */
    const record = await this.incidents.report(user.sub, {
      ...dto,
      depotId: user.depotId ?? dto.depotId,
    });
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
