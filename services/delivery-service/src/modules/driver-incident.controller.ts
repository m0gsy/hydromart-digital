import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, Role, Roles } from '@hydromart/platform';

import { IncidentService } from '../application/services/incident.service';
import { IncidentRecord } from '../application/ports/incident.repository';
import { IncidentDto, ListDepotIncidentsDto, ReportIncidentDto } from './dto/incident.dto';

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
    return IncidentDto.from(record, await this.incidents.signedPhotoUrl(record.photoUrl));
  }


  /**
   * CA-4-49: the stored URL is the object's stable id, not something a browser can open —
   * the bucket is private. Every read mints a fresh expiring link, and only for the rows
   * that actually carry a photo.
   */
  private withSignedPhotos(records: IncidentRecord[]): Promise<IncidentDto[]> {
    return Promise.all(
      records.map(async (r) => IncidentDto.from(r, await this.incidents.signedPhotoUrl(r.photoUrl))),
    );
  }

  @Get()
  @ApiOperation({ summary: "List the current courier's reported incidents" })
  @ApiOkResponse({ type: IncidentDto, isArray: true })
  async list(@CurrentUser() user: AuthenticatedUser): Promise<IncidentDto[]> {
    const records = await this.incidents.listForDriver(user.sub);
    return this.withSignedPhotos(records);
  }
}

/**
 * CA-4-48 — the depot's review list.
 *
 * `escalatesToOps` interrupts an operator for HIGH severity and leaves LOW and MEDIUM
 * "logged for later review". Nothing could review them: the only other read on this table
 * was a courier's own history, so the person who wrote the report was the only person who
 * could read it. Same capability as the depot's operational incidents inbox — the readers
 * are the same people, and this is the same kind of thing happening to the same depot.
 */
@ApiTags('Driver Incidents')
@ApiBearerAuth()
@Can('incidents')
@Controller({ path: 'field-incidents', version: '1' })
export class FieldIncidentController {
  constructor(private readonly incidents: IncidentService) {}

  @Get()
  @ApiOperation({ summary: 'Field incidents reported by a depot’s couriers, newest first' })
  @ApiOkResponse({ type: IncidentDto, isArray: true })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListDepotIncidentsDto,
  ): Promise<IncidentDto[]> {
    const records = await this.incidents.listForDepot(user, query.depotId);
    return this.withSignedPhotos(records);
  }

  /**
   * CA-4-49: the stored URL is the object's stable id, not something a browser can open —
   * the bucket is private. Every read mints a fresh expiring link, and only for the rows
   * that actually carry a photo.
   */
  private withSignedPhotos(records: IncidentRecord[]): Promise<IncidentDto[]> {
    return Promise.all(
      records.map(async (r) => IncidentDto.from(r, await this.incidents.signedPhotoUrl(r.photoUrl))),
    );
  }
}
