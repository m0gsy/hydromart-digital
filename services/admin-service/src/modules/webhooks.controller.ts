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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import { WebhookService } from '../application/services/webhook.service';
import { CreateWebhookDto, UpdateWebhookDto, WebhookDto } from './dto/webhook.dto';

// Design 19c — webhook subscriptions. SUPER_ADMIN only.
//
// H-30: CRUD only. Nothing in the platform dispatches to these endpoints, so the stored
// delivery status and success rate are null not because it has been quiet, but because no
// event has ever been sent. Said plainly here and on the HQ page rather than letting an
// empty column read as "healthy".
@ApiTags('Webhooks')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller({ path: 'webhooks', version: '1' })
export class WebhooksController {
  constructor(private readonly webhooks: WebhookService) {}

  @Get()
  @ApiOperation({
    summary: 'List webhook endpoints (19c)',
    description: 'A registry only — no event is dispatched to these endpoints yet.',
  })
  async list(): Promise<WebhookDto[]> {
    return (await this.webhooks.list()).map((w) => WebhookDto.from(w));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a webhook endpoint' })
  async create(@Body() dto: CreateWebhookDto): Promise<WebhookDto> {
    return WebhookDto.from(await this.webhooks.create(dto));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Toggle / edit a webhook endpoint' })
  async update(@Param('id') id: string, @Body() dto: UpdateWebhookDto): Promise<WebhookDto> {
    return WebhookDto.from(await this.webhooks.update(id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a webhook endpoint' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.webhooks.remove(id);
  }
}
