import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { PartnerBillNoticeService } from '../application/services/partner-bill-notice.service';
import { PartnerBillNoticeDto, PartnerBillNoticeResultDto } from './dto/notification.dto';

/** HD-23: payout-service's approved royalty bills. Internal key only, never a user token. */
@ApiTags('Notifications')
@Controller({ path: 'notifications', version: '1' })
export class PartnerBillNoticeController {
  constructor(private readonly notices: PartnerBillNoticeService) {}

  @ApiOkResponse({ type: PartnerBillNoticeResultDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/partner-bill')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Tell each franchise owner their monthly royalty bill was sent (internal)' })
  partnerBill(@Body() dto: PartnerBillNoticeDto): Promise<PartnerBillNoticeResultDto> {
    return this.notices.run(dto);
  }
}
