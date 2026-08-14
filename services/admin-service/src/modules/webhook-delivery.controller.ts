import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { Can, InternalAuthGuard, Public } from '@hydromart/platform';

import { WebhookDispatchService } from '../application/services/webhook-dispatch.service';
import { ApiKeyGuard, ApiScopes } from './api-key.guard';
import {
  ListDeliveriesDto,
  PublishEventDto,
  WebhookDeliveryDto,
} from './dto/webhook-delivery.dto';

/**
 * Event ingest + the dispatch sweep. Not JWT routes: services report events with the
 * shared internal key, and the scheduler drains the queue the same way it drives the
 * retention purge.
 */
@ApiTags('Webhooks (internal)')
@Controller({ path: 'webhooks', version: '1' })
export class WebhookInternalController {
  constructor(private readonly dispatch: WebhookDispatchService) {}

  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('events')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOkResponse({ description: 'How many deliveries this event queued.' })
  @ApiOperation({
    summary: 'Report a domain event; queues one delivery per subscribed endpoint (19c)',
  })
  publish(@Body() dto: PublishEventDto): Promise<{ queued: number }> {
    return this.dispatch.publish({
      event: dto.event,
      payload: dto.payload,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,
    });
  }

  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('deliveries/process')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send every due webhook delivery (scheduler sweep)' })
  @ApiOkResponse({ description: 'Counts for this sweep: sent, failed, dead.' })
  process(): Promise<{ sent: number; failed: number; dead: number }> {
    return this.dispatch.process();
  }
}

/** HQ's view of what was actually delivered, and the button to send one again. */
@ApiTags('Webhooks')
@Can('platformAdmin')
@Controller({ path: 'webhooks/deliveries', version: '1' })
export class WebhookDeliveryController {
  constructor(private readonly dispatch: WebhookDispatchService) {}

  @Get()
  @ApiOperation({ summary: 'Recent webhook deliveries, newest first' })
  @ApiOkResponse({ type: WebhookDeliveryDto, isArray: true })
  async list(@Query() query: ListDeliveriesDto): Promise<WebhookDeliveryDto[]> {
    return (await this.dispatch.list(query.limit, query.event)).map(WebhookDeliveryDto.from);
  }

  @Post(':id/replay')
  @ApiOperation({ summary: 'Queue one delivery for another attempt' })
  @ApiOkResponse({ type: WebhookDeliveryDto })
  async replay(@Param('id', ParseUUIDPipe) id: string): Promise<WebhookDeliveryDto> {
    return WebhookDeliveryDto.from(await this.dispatch.replay(id));
  }
}

/**
 * The partner-facing API — the surface an API key actually authenticates.
 *
 * Deliberately the integration's own data: a partner can see what we sent them and ask
 * for it again. `@Public()` bypasses the JWT guard because a partner has no session; the
 * key IS the credential, and ApiKeyGuard is fail-closed.
 */
@ApiTags('Partner API')
@Public()
@UseGuards(ApiKeyGuard)
@ApiSecurity('api-key')
@Controller({ path: 'partner/deliveries', version: '1' })
export class PartnerDeliveryController {
  constructor(private readonly dispatch: WebhookDispatchService) {}

  @Get()
  @ApiScopes('webhooks:read')
  @ApiOperation({ summary: 'Webhook deliveries sent to you, newest first (API key)' })
  @ApiOkResponse({ type: WebhookDeliveryDto, isArray: true })
  async list(@Query() query: ListDeliveriesDto): Promise<WebhookDeliveryDto[]> {
    return (await this.dispatch.list(query.limit, query.event)).map(WebhookDeliveryDto.from);
  }

  @Post(':id/replay')
  @ApiScopes('webhooks:write')
  @ApiOperation({ summary: 'Ask for one delivery to be sent again (API key)' })
  @ApiOkResponse({ type: WebhookDeliveryDto })
  async replay(@Param('id', ParseUUIDPipe) id: string): Promise<WebhookDeliveryDto> {
    return WebhookDeliveryDto.from(await this.dispatch.replay(id));
  }
}
