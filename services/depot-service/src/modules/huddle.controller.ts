import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, CurrentUser, AuthenticatedUser } from '@hydromart/platform';

import { HuddleService } from '../application/services/huddle.service';
import { HuddleNote } from '../domain/huddle';
import { ListHuddleQueryDto, UpsertHuddleNoteDto } from './dto/huddle.dto';
import { HuddleNoteResponseDto } from './dto/responses.generated.dto';

/** Weekly depot team huddle notes (design depotTeam). */
@ApiTags('Huddle notes')
@ApiBearerAuth()
@Can('depotHuddle')
@Controller({ path: 'huddle-notes', version: '1' })
export class HuddleController {
  constructor(private readonly huddles: HuddleService) {}

  @Get()
  @ApiOperation({
    summary: "List a depot's huddle notes (newest first), or the single note for one week",
  })
  list(@Query() query: ListHuddleQueryDto): Promise<HuddleNote | HuddleNote[] | null> {
    if (query.weekStart) {
      return this.huddles.getForWeek(query.depotId, query.weekStart);
    }
    return this.huddles.list(query.depotId);
  }

  @ApiOkResponse({ type: HuddleNoteResponseDto })
  @Put()
  @ApiOperation({ summary: "Upsert a week's huddle note (by depot + weekStart)" })
  upsert(
    @Body() dto: UpsertHuddleNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<HuddleNote> {
    return this.huddles.record(
      {
        depotId: dto.depotId,
        weekStart: dto.weekStart,
        attendance: dto.attendance ?? null,
        agenda: dto.agenda,
        actionItems: dto.actionItems,
      },
      user.sub,
    );
  }
}
