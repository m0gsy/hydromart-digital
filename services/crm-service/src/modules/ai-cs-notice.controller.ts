import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuditMutationsInterceptor, Can, ExternalAccess } from '@hydromart/platform';

import { AiCsNoticeService } from '../application/services/ai-cs-notice.service';
import { aiCsEventIdPattern } from '../domain/ai-cs-notice';
import { AiCsNoticeDto, AiCsNoticeResultDto } from './dto/notification.dto';

/**
 * AI-11: the AI web's CS inbox (WhatsApp number 2) relays a chat handed to CS (NEW) or one that waits
 * too long (REMIND after 15 working minutes, ESCALATE after 60). Like the other routes under
 * notifications/external: only a machine ES256 token holding `aiCsNotify`, audited before it runs
 * (503 when the audit cannot be written). A conversation id and a kind only: no customer name,
 * number or text passes. hydromart picks the recipients (aiCsReply holders; aiCsManage for ESCALATE)
 * and writes the words; it goes out as bell, push and email (WhatsApp stays `pending`).
 * AiCsNoticeService names the events, so staff-email.spec.ts holds it to the same email/switch rule.
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller({ path: 'notifications/external', version: '1' })
export class AiCsNoticeController {
  constructor(private readonly aiCsNotices: AiCsNoticeService) {}

  @ExternalAccess('machine')
  @Can('aiCsNotify')
  @UseInterceptors(AuditMutationsInterceptor)
  @Post('ai-cs-notice')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'AI web: tell CS that a chat was handed over, or that nobody answered in time (AI-11)' })
  @ApiOkResponse({ type: AiCsNoticeResultDto })
  async aiCsNotice(@Body() dto: AiCsNoticeDto): Promise<AiCsNoticeResultDto> {
    if (!aiCsEventIdPattern(dto.kind, dto.conversationId).test(dto.eventId)) {
      throw new BadRequestException('eventId must be ai-cs:<conversationId> for NEW, ai-cs-overdue:<conversationId>:<kind> otherwise');
    }
    return this.aiCsNotices.run(dto);
  }
}
