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
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { CAPABILITIES } from '@hydromart/access';
import {
  AuthenticatedUser,
  CurrentUser,
  InternalAuthGuard,
  Public,
  Roles,
} from '@hydromart/platform';

import { AnnouncementService } from '../application/services/announcement.service';
import { CreateAnnouncementDto, ListAnnouncementDto } from './dto/announcement.dto';

/** Writing and tracking announcements. Read hrView, write hrAdmin. */
@ApiTags('HR Announcements')
@ApiBearerAuth()
@Controller({ path: 'announcements', version: '1' })
export class AnnouncementController {
  constructor(private readonly announcements: AnnouncementService) {}

  @Get()
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'List announcements, drafts included, newest first' })
  list(@Query() q: ListAnnouncementDto) {
    return this.announcements.list(q.page, q.pageSize);
  }

  @Get(':id')
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'One announcement with its targets and read statistics' })
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.getById(id);
  }

  @Post()
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Write an announcement (sends now unless scheduledAt is in future)' })
  create(@Body() dto: CreateAnnouncementDto, @CurrentUser() user: AuthenticatedUser) {
    return this.announcements.create(user, dto);
  }

  /**
   * Release everything whose schedule has come due. Same shape as order-service's
   * expireAbandoned: one sweep, driven from outside, instead of a timer inside every
   * replica racing to send the same notice.
   */
  @Post('publish-due')
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @HttpCode(200)
  @ApiOperation({ summary: 'Publish scheduled announcements that are now due (internal)' })
  publishDue() {
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
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.announcements.listForSelf(user);
  }

  @Post(':id/read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark an announcement read (idempotent)' })
  markRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.announcements.markRead(user, id);
  }
}
