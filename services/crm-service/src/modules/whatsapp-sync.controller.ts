import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuditMutationsInterceptor, Can, ExternalAccess } from '@hydromart/platform';

import { WhatsappConsentService } from '../application/services/whatsapp-consent.service';
import { OptOutsDto, OptOutsQueryDto } from './dto/whatsapp.dto';

/**
 * The STOP list between number 1 (here) and number 2 (the AI web). Machine token with `waOptOutSync` only
 * (contracts/ai-v1/whatsapp.openapi.json). The ledger is data, so these answer while the channel is off.
 */
@ApiTags('WhatsApp')
@ApiBearerAuth()
@Controller({ path: 'whatsapp/opt-outs', version: '1' })
export class WhatsappSyncController {
  constructor(private readonly consent: WhatsappConsentService) {}

  @ApiOkResponse({ description: 'A page of consent rows with their ids, and the next cursor.' })
  @ExternalAccess('machine')
  @Can('waOptOutSync')
  @Get()
  @ApiOperation({ summary: 'AI web: the STOP/MULAI rows number 1 wrote after a cursor (poll every 30-60 s)' })
  list(@Query() query: OptOutsQueryDto) {
    return this.consent.optOutsAfter(query.after ?? 0, query.limit ?? 500);
  }

  @ApiOkResponse({ description: 'How many items were written and how many were repeats.' })
  @ExternalAccess('machine')
  @Can('waOptOutSync')
  @UseInterceptors(AuditMutationsInterceptor)
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'AI web: its own number-2 STOP/MULAI, idempotent on eventId' })
  accept(@Body() dto: OptOutsDto) {
    return this.consent.acceptOptOuts(dto.items);
  }
}
