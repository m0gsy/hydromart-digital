import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard, DepotScopeGuard } from '@hydromart/platform';

import { CrmConfigService } from '../config/crm-config.service';
import { CRM_TOKENS } from '../application/tokens';
import { CampaignService } from '../application/services/campaign.service';
import { SavedSegmentService } from '../application/services/saved-segment.service';
import { NotificationService } from '../application/services/notification.service';
import { BroadcastService } from '../application/services/broadcast.service';
import { PushService } from '../application/services/push.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { CampaignPrismaRepository } from '../infrastructure/prisma/campaign.prisma.repository';
import { SavedSegmentPrismaRepository } from '../infrastructure/prisma/saved-segment.prisma.repository';
import { NotificationPrismaRepository } from '../infrastructure/prisma/notification.prisma.repository';
import { BroadcastPrismaRepository } from '../infrastructure/prisma/broadcast.prisma.repository';
import { PushSubscriptionPrismaRepository } from '../infrastructure/prisma/push.prisma.repository';
import { WhatsappBroadcastHttpAdapter } from '../infrastructure/whatsapp/whatsapp-broadcast.http.adapter';
import { WebPushSenderAdapter } from '../infrastructure/webpush/web-push.sender.adapter';
import { FcmSenderAdapter } from '../infrastructure/fcm/fcm.sender.adapter';
import { CompositePushSender } from '../infrastructure/push/composite-push.sender';
import { CustomerDirectoryHttpAdapter } from '../infrastructure/http/customer-directory.http.adapter';
import { ActivitySegmentHttpAdapter } from '../infrastructure/http/activity-segment.http.adapter';
import { CampaignController } from './campaign.controller';
import { SavedSegmentController } from './saved-segment.controller';
import { NotificationController } from './notification.controller';
import { BroadcastController } from './broadcast.controller';
import { PushController } from './push.controller';

const providers: Provider[] = [
  PrismaService,
  CrmConfigService,
  CampaignService,
  SavedSegmentService,
  NotificationService,
  BroadcastService,
  PushService,
  { provide: CRM_TOKENS.CampaignRepository, useClass: CampaignPrismaRepository },
  { provide: CRM_TOKENS.SavedSegmentRepository, useClass: SavedSegmentPrismaRepository },
  { provide: CRM_TOKENS.NotificationRepository, useClass: NotificationPrismaRepository },
  { provide: CRM_TOKENS.BroadcastRepository, useClass: BroadcastPrismaRepository },
  { provide: CRM_TOKENS.WhatsappBroadcast, useClass: WhatsappBroadcastHttpAdapter },
  { provide: CRM_TOKENS.CustomerDirectory, useClass: CustomerDirectoryHttpAdapter },
  { provide: CRM_TOKENS.ActivitySegment, useClass: ActivitySegmentHttpAdapter },
  { provide: CRM_TOKENS.PushSubscriptionRepository, useClass: PushSubscriptionPrismaRepository },
  // Both transports are always constructed; the composite routes per subscription by the
  // endpoint prefix. Each disables itself when its own credentials are unset, so a
  // deployment with only VAPID (or only FCM) configured still works for that half.
  WebPushSenderAdapter,
  FcmSenderAdapter,
  { provide: CRM_TOKENS.PushSender, useClass: CompositePushSender },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  { provide: APP_GUARD, useClass: DepotScopeGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [CampaignController, SavedSegmentController, NotificationController, BroadcastController, PushController],
  providers,
  exports: [PrismaService, CrmConfigService],
})
export class CampaignModule {}
