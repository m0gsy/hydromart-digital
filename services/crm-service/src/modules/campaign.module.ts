import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard } from '@hydromart/platform';

import { CrmConfigService } from '../config/crm-config.service';
import { CRM_TOKENS } from '../application/tokens';
import { CampaignService } from '../application/services/campaign.service';
import { NotificationService } from '../application/services/notification.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { CampaignPrismaRepository } from '../infrastructure/prisma/campaign.prisma.repository';
import { NotificationPrismaRepository } from '../infrastructure/prisma/notification.prisma.repository';
import { WhatsappBroadcastHttpAdapter } from '../infrastructure/whatsapp/whatsapp-broadcast.http.adapter';
import { CampaignController } from './campaign.controller';
import { NotificationController } from './notification.controller';

const providers: Provider[] = [
  PrismaService,
  CrmConfigService,
  CampaignService,
  NotificationService,
  { provide: CRM_TOKENS.CampaignRepository, useClass: CampaignPrismaRepository },
  { provide: CRM_TOKENS.NotificationRepository, useClass: NotificationPrismaRepository },
  { provide: CRM_TOKENS.WhatsappBroadcast, useClass: WhatsappBroadcastHttpAdapter },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [CampaignController, NotificationController],
  providers,
  exports: [PrismaService, CrmConfigService],
})
export class CampaignModule {}
