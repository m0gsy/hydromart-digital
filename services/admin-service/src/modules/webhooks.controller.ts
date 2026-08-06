import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import { WebhookService } from '../application/services/webhook.service';
import { CreateWebhookDto, UpdateWebhookDto, WebhookDto } from './dto/webhook.dto';

// Design 19c — webhook subscriptions. SUPER_ADMIN only.
//
// H-30: these subscriptions are delivered against. A service reports an event to
// POST /webhooks/events, one delivery row is queued per subscribed endpoint, and the
// scheduler sweep sends them signed (X-Hydromart-Signature) with backoff. The stored
// status and success rate are computed from those attempts.
@ApiTags('Webhooks')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller({ path: 'webhooks', version: '1' })
export class WebhooksController {
  constructor(private readonly webhooks: WebhookService) {}

  @ApiOkResponse({ type: WebhookDto, isArray: true })
  @Get()
  @ApiOperation({
    summary: 'List webhook endpoints (19c)',
    description:
      'Subscribed endpoints receive signed POSTs; see /webhooks/deliveries for what was sent.',
  })
  async list(): Promise<WebhookDto[]> {
    return (await this.webhooks.list()).map((w) => WebhookDto.from(w));
  }

  @ApiOkResponse({ type: WebhookDto })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a webhook endpoint' })
  async create(@Body() dto: CreateWebhookDto): Promise<WebhookDto> {
    return WebhookDto.from(await this.webhooks.create(dto));
  }

  @ApiOkResponse({ type: WebhookDto })
  @Patch(':id')
  @ApiOperation({ summary: 'Toggle / edit a webhook endpoint' })
  async update(@Param('id') id: string, @Body() dto: UpdateWebhookDto): Promise<WebhookDto> {
    return WebhookDto.from(await this.webhooks.update(id, dto));
  }

  @ApiOkResponse({ description: 'No content.' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a webhook endpoint' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.webhooks.remove(id);
  }
}
