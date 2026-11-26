import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { VisitNoticeService } from '../application/services/visit-notice.service';
import { VisitNoticeDto, VisitNoticeResultDto } from './dto/notification.dto';

/** HD-15B: depot-service's supervisor-visit notices. Internal key only, never a user token. */
@ApiTags('Notifications')
@Controller({ path: 'notifications', version: '1' })
export class VisitNoticeController {
  constructor(private readonly notices: VisitNoticeService) {}

  @ApiOkResponse({ type: VisitNoticeResultDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/visit-notice')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Tell a depot\'s Kepala, supervisors and HQ about visit findings or overdue follow-ups (internal)' })
  visitNotice(@Body() dto: VisitNoticeDto): Promise<VisitNoticeResultDto> {
    return this.notices.run(dto);
  }
}
