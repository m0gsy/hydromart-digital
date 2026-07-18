import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, AuthenticatedUser, Roles, assertDepotAccess } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { HandoverService } from '../application/services/handover.service';
import { ShiftHandover } from '../domain/handover';
import { CreateHandoverDto, ListHandoverQueryDto } from './dto/handover.dto';

/** Shift handover checklist (design 14d). */
@ApiTags('Shift handovers')
@ApiBearerAuth()
@Roles(...CAPABILITIES.depotTeam)
@Controller({ path: 'shift-handovers', version: '1' })
export class HandoverController {
  constructor(private readonly handovers: HandoverService) {}

  @Post()
  @ApiOperation({ summary: 'Record an (unsigned) shift handover' })
  record(
    @Body() dto: CreateHandoverDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ShiftHandover> {
    return this.handovers.record(
      {
        depotId: dto.depotId,
        fromShift: dto.fromShift,
        toShift: dto.toShift,
        fromStaff: dto.fromStaff,
        toStaff: dto.toStaff,
        items: dto.items,
        note: dto.note ?? null,
      },
      user.sub,
    );
  }

  @Get()
  @ApiOperation({ summary: "List a depot's shift handovers (newest first)" })
  list(@Query() query: ListHandoverQueryDto): Promise<ShiftHandover[]> {
    return this.handovers.list(query.depotId);
  }

  @Patch(':id/sign')
  @ApiOperation({ summary: 'Sign a shift handover (stamps signedAt)' })
  async sign(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ShiftHandover> {
    assertDepotAccess(user, (await this.handovers.get(id)).depotId);
    return this.handovers.sign(id);
  }
}
