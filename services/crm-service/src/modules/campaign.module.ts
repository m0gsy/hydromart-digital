import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard } from '@hydromart/platform';

import { CrmConfigService } from '../config/crm-config.service';
import { CRM_TOKENS } from '../application/tokens';
import { CampaignService } from '../application/services/campaign.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { CampaignPrismaRepository } from '../infrastructure/prisma/campaign.prisma.repository';
import { WhatsappBroadcastHttpAdapter } from '../infrastructure/whatsapp/whatsapp-broadcast.http.adapter';
import { CampaignController } from './campaign.controller';

const providers: Provider[] = [
  PrismaService,
  CrmConfigService,
  CampaignService,
  { provide: CRM_TOKENS.CampaignRepository, useClass: CampaignPrismaRepository },
  { provide: CRM_TOKENS.WhatsappBroadcast, useClass: WhatsappBroadcastHttpAdapter },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [CampaignController],
  providers,
  exports: [PrismaService, CrmConfigService],
})
export class CampaignModule {}
