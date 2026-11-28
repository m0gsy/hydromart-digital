import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController, ApiOkResponse } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';

import { Public } from '@hydromart/platform';

import { CrmConfigService } from '../config/crm-config.service';
import { WhatsappWebhookService } from '../application/services/whatsapp-webhook.service';
import { MetaSignatureGuard, WaReadyGuard } from './whatsapp.guards';

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Meta's callback: `https://<api host>/crm/api/v1/whatsapp/webhook`. Public on purpose (Meta has no token of
 * ours): the GET answers only the verify token, the POST only a body signed with the app secret.
 */
@ApiExcludeController()
@Controller({ path: 'whatsapp/webhook', version: '1' })
export class WhatsappWebhookController {
  constructor(
    private readonly config: CrmConfigService,
    private readonly webhook: WhatsappWebhookService,
  ) {}

  @ApiOkResponse({ description: 'Meta challenge echoed as plain text.' })
  @Public()
  @UseGuards(WaReadyGuard)
  @Get()
  @Header('Content-Type', 'text/plain')
  verify(@Query() query: Record<string, string>): string {
    const token = query['hub.verify_token'];
    if (query['hub.mode'] !== 'subscribe' || typeof token !== 'string' || !same(token, this.config.whatsapp.verifyToken)) {
      throw new ForbiddenException();
    }
    return String(query['hub.challenge'] ?? '');
  }

  @ApiOkResponse({ description: 'Acknowledged: { ok: true }.' })
  @Public()
  @UseGuards(WaReadyGuard, MetaSignatureGuard)
  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Body() payload: unknown): Promise<{ ok: true }> {
    await this.webhook.handle(payload);
    return { ok: true };
  }
}
