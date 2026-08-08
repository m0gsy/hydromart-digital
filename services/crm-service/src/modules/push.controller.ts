import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser } from '@hydromart/platform';

import { CrmConfigService } from '../config/crm-config.service';
import { PushService } from '../application/services/push.service';
import { SubscribePushDto } from './dto/push.dto';
import { VapidPublicKey3ResponseDto } from './dto/responses.generated.dto';

/**
 * Web Push subscription management (design 7b transport). Any authenticated user — the
 * caller registers/removes their own browser's push endpoint; the VAPID public key is
 * needed client-side to create the subscription.
 */
@ApiTags('Push')
@ApiBearerAuth()
@Controller({ path: 'push', version: '1' })
export class PushController {
  constructor(
    private readonly push: PushService,
    private readonly config: CrmConfigService,
  ) {}

  @ApiOkResponse({ type: VapidPublicKey3ResponseDto })
  @Get('vapid-public-key')
  @ApiOperation({ summary: 'Public VAPID key the browser needs to subscribe (empty = push off)' })
  vapidPublicKey(): { key: string } {
    return { key: this.config.vapid.publicKey };
  }

  @ApiOkResponse({ description: 'No content.' })
  @Post('subscriptions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Register this device for push notifications' })
  async subscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubscribePushDto,
  ): Promise<void> {
    // An FCM registration carries no keypair. The columns are NOT NULL and stay that way
    // — no migration for this — so they hold empty strings for an Android row, which the
    // FCM adapter never reads.
    await this.push.subscribe(user.sub, {
      endpoint: dto.endpoint,
      p256dh: dto.keys?.p256dh ?? '',
      auth: dto.keys?.auth ?? '',
    });
  }

  @ApiOkResponse({ description: 'No content.' })
  @Delete('subscriptions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiQuery({ name: 'endpoint', required: true })
  @ApiOperation({ summary: 'Remove a device push subscription' })
  async unsubscribe(@Query('endpoint') endpoint: string): Promise<void> {
    if (!endpoint) throw new BadRequestException('endpoint is required');
    await this.push.unsubscribe(endpoint);
  }
}
