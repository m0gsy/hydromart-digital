import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { Can, AuthenticatedUser, CurrentUser, InternalAuthGuard, Public } from '@hydromart/platform';

import { AnnouncementService } from '../application/services/announcement.service';
import { CreateAnnouncementDto, ListAnnouncementDto } from './dto/announcement.dto';
import { AnnouncementWithTargets } from '../application/ports/announcement.repository';
import { AnnouncementStats } from '../application/services/announcement.service';
import { AnnouncementWithTargetsResponseDto, GetByIdResponseDto, MarkRead3ResponseDto, PublishDue3ResponseDto } from './dto/responses.generated.dto';

/** Writing and tracking announcements. Read hrView, write hrAdmin. */
@ApiTags('HR Announcements')
@ApiBearerAuth()
@Controller({ path: 'announcements', version: '1' })
export class AnnouncementController {
  constructor(private readonly announcements: AnnouncementService) {}

  @Get()
  @Can('hrView')
  @ApiOperation({ summary: 'List announcements, drafts included, newest first' })
  list(@Query() q: ListAnnouncementDto, @CurrentUser() user: AuthenticatedUser) {
    // CA-1-29: who is asking decides what comes back — drafts only for a writer, and only
    // this reader's own depots unless they sit above depots entirely.
    return this.announcements.list(user, q.page, q.pageSize);
  }

  @ApiOkResponse({ type: GetByIdResponseDto })
  @Get(':id')
  @Can('hrView')
  @ApiOperation({ summary: 'One announcement with its targets and read statistics' })
  getById(@Param('id', ParseUUIDPipe) id: string): Promise<AnnouncementWithTargets & AnnouncementStats> {
    return this.announcements.getById(id);
  }

  @ApiOkResponse({ type: AnnouncementWithTargetsResponseDto })
  @Post()
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Write an announcement (sends now unless scheduledAt is in future)' })
  create(@Body() dto: CreateAnnouncementDto, @CurrentUser() user: AuthenticatedUser): Promise<AnnouncementWithTargets> {
    return this.announcements.create(user, dto);
  }

  /**
   * Release everything whose schedule has come due. Same shape as order-service's
   * expireAbandoned: one sweep, driven from outside, instead of a timer inside every
   * replica racing to send the same notice.
   */
  @ApiOkResponse({ type: PublishDue3ResponseDto })
  @Post('publish-due')
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @HttpCode(200)
  @ApiOperation({ summary: 'Publish scheduled announcements that are now due (internal)' })
  publishDue(): Promise<{ published: number }> {
    return this.announcements.publishDue();
  }
}

/** What an employee sees of it. */
@ApiTags('HR Announcements')
@ApiBearerAuth()
@Controller({ path: 'announcements/me', version: '1' })
export class SelfAnnouncementController {
  constructor(private readonly announcements: AnnouncementService) {}

  @Get()
  @ApiOperation({ summary: 'Announcements addressed to me, newest first' })
  list(@CurrentUser() user: AuthenticatedUser): Promise<(AnnouncementWithTargets & { read: boolean })[]> {
    return this.announcements.listForSelf(user);
  }

  @ApiOkResponse({ type: MarkRead3ResponseDto })
  @Post(':id/read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark an announcement read (idempotent)' })
  markRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser): Promise<{ readAt: Date }> {
    return this.announcements.markRead(user, id);
  }
}
