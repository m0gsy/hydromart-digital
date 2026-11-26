import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { AUDIT_MUTATION_SINK, JwtAuthGuard, RolesGuard, DepotScopeGuard } from '@hydromart/platform';

import { CrmConfigService } from '../config/crm-config.service';
import { CRM_TOKENS } from '../application/tokens';
import { CampaignService } from '../application/services/campaign.service';
import { SavedSegmentService } from '../application/services/saved-segment.service';
import { NotificationService } from '../application/services/notification.service';
import { AiAccessRequestService } from '../application/services/ai-access-request.service';
import { ComplianceDueService } from '../application/services/compliance-due.service';
import { HeldDepotsHttpAdapter } from '../infrastructure/http/held-depots.http.adapter';
import { ComplianceDueHttpAdapter } from '../infrastructure/http/compliance-due.http.adapter';
import { AiAgentNoticeService } from '../application/services/ai-agent-notice.service';
import { SalesWeeklyService } from '../application/services/sales-weekly.service';
import { LegalEntityAudienceHttpAdapter } from '../infrastructure/http/legal-entity-audience.http.adapter';
import { MaintenanceDueService } from '../application/services/maintenance-due.service';
import { DepotAudienceService } from '../application/services/depot-audience.service';
import { VisitNoticeService } from '../application/services/visit-notice.service';
import { PartnerBillNoticeService } from '../application/services/partner-bill-notice.service';
import { MaintenanceDueHttpAdapter } from '../infrastructure/http/maintenance-due.http.adapter';
import { MorningSummaryService } from '../application/services/morning-summary.service';
import { CustomerReminderService } from '../application/services/customer-reminder.service';
import { CustomerReminderSourceHttpAdapter } from '../infrastructure/http/customer-reminder-source.http.adapter';
import { BroadcastService } from '../application/services/broadcast.service';
import { PushService } from '../application/services/push.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { CampaignPrismaRepository } from '../infrastructure/prisma/campaign.prisma.repository';
import { SavedSegmentPrismaRepository } from '../infrastructure/prisma/saved-segment.prisma.repository';
import { NotificationPrismaRepository } from '../infrastructure/prisma/notification.prisma.repository';
import { BroadcastPrismaRepository } from '../infrastructure/prisma/broadcast.prisma.repository';
import { PushSubscriptionPrismaRepository } from '../infrastructure/prisma/push.prisma.repository';
import { WebPushSenderAdapter } from '../infrastructure/webpush/web-push.sender.adapter';
import { FcmSenderAdapter } from '../infrastructure/fcm/fcm.sender.adapter';
import { CompositePushSender } from '../infrastructure/push/composite-push.sender';
import { InboxBroadcastDelivery } from '../infrastructure/notification/inbox-broadcast.delivery';
import { CustomerDirectoryHttpAdapter } from '../infrastructure/http/customer-directory.http.adapter';
import { DepotStaffHttpAdapter } from '../infrastructure/http/depot-staff.http.adapter';
import { StaffPrefsHttpAdapter } from '../infrastructure/http/staff-prefs.http.adapter';
import { DestinationBrakesHttpAdapter } from '../infrastructure/http/destination-brakes.http.adapter';
import { ApproverDirectoryHttpAdapter } from '../infrastructure/http/approver-directory.http.adapter';
import { StaffEmailHttpAdapter } from '../infrastructure/http/staff-email.http.adapter';
import { LegalEntityNamesHttpAdapter } from '../infrastructure/http/legal-entity-names.http.adapter';
import { PendingApprovalsHttpAdapter } from '../infrastructure/http/pending-approvals.http.adapter';
import { DepotOverseersHttpAdapter } from '../infrastructure/http/depot-overseers.http.adapter';
import { NotificationPreferenceHttpAdapter } from '../infrastructure/http/notification-preference.http.adapter';
import { ActivitySegmentHttpAdapter } from '../infrastructure/http/activity-segment.http.adapter';
import { CrmAuditSink } from '../infrastructure/http/audit.sink';
import { AiCampaignService } from '../application/services/ai-campaign.service';
import { AI_CAMPAIGN_REPOSITORY } from '../application/ports/ai-campaign.repository';
import { AiCampaignPrismaRepository } from '../infrastructure/prisma/ai-campaign.prisma.repository';
import { AiDraftController } from './ai-draft.controller';
import { AiCampaignController } from './ai-campaign.controller';
import { CampaignController } from './campaign.controller';
import { SavedSegmentController } from './saved-segment.controller';
import { NotificationController } from './notification.controller';
import { VisitNoticeController } from './visit-notice.controller';
import { PartnerBillNoticeController } from './partner-bill-notice.controller';
import { NotificationExternalController } from './notification-external.controller';
import { BroadcastController } from './broadcast.controller';
import { PushController } from './push.controller';

const providers: Provider[] = [
  PrismaService,
  CrmConfigService,
  CampaignService,
  AiCampaignService,
  { provide: AI_CAMPAIGN_REPOSITORY, useClass: AiCampaignPrismaRepository },
  SavedSegmentService,
  NotificationService,
  MorningSummaryService,
  AiAccessRequestService,
  MaintenanceDueService,
  ComplianceDueService,
  SalesWeeklyService,
  AiAgentNoticeService,
  { provide: CRM_TOKENS.LegalEntityAudience, useClass: LegalEntityAudienceHttpAdapter },
  DepotAudienceService,
  VisitNoticeService,
  PartnerBillNoticeService,
  { provide: CRM_TOKENS.MaintenanceDue, useClass: MaintenanceDueHttpAdapter },
  { provide: CRM_TOKENS.ComplianceDue, useClass: ComplianceDueHttpAdapter },
  { provide: CRM_TOKENS.HeldDepots, useClass: HeldDepotsHttpAdapter },
  BroadcastService,
  PushService,
  { provide: CRM_TOKENS.CampaignRepository, useClass: CampaignPrismaRepository },
  { provide: CRM_TOKENS.SavedSegmentRepository, useClass: SavedSegmentPrismaRepository },
  { provide: CRM_TOKENS.NotificationRepository, useClass: NotificationPrismaRepository },
  { provide: CRM_TOKENS.BroadcastRepository, useClass: BroadcastPrismaRepository },
  { provide: CRM_TOKENS.BroadcastDelivery, useClass: InboxBroadcastDelivery },
  { provide: CRM_TOKENS.CustomerDirectory, useClass: CustomerDirectoryHttpAdapter },
  { provide: CRM_TOKENS.NotificationPreference, useClass: NotificationPreferenceHttpAdapter },
  { provide: CRM_TOKENS.DepotStaff, useClass: DepotStaffHttpAdapter },
  { provide: CRM_TOKENS.StaffPrefs, useClass: StaffPrefsHttpAdapter },
  { provide: CRM_TOKENS.DepotOverseers, useClass: DepotOverseersHttpAdapter },
  { provide: CRM_TOKENS.DestinationBrakes, useClass: DestinationBrakesHttpAdapter },
  { provide: CRM_TOKENS.ApproverDirectory, useClass: ApproverDirectoryHttpAdapter },
  { provide: CRM_TOKENS.StaffEmail, useClass: StaffEmailHttpAdapter },
  { provide: CRM_TOKENS.PendingApprovals, useClass: PendingApprovalsHttpAdapter },
  { provide: CRM_TOKENS.LegalEntityNames, useClass: LegalEntityNamesHttpAdapter },
  { provide: CRM_TOKENS.ActivitySegment, useClass: ActivitySegmentHttpAdapter },
  { provide: CRM_TOKENS.PushSubscriptionRepository, useClass: PushSubscriptionPrismaRepository },
  // Both transports are always constructed; the composite routes per subscription by the
  // endpoint prefix. Each disables itself when its own credentials are unset, so a
  // deployment with only VAPID (or only FCM) configured still works for that half.
  WebPushSenderAdapter,
  FcmSenderAdapter,
  { provide: CRM_TOKENS.PushSender, useClass: CompositePushSender },
  // AI-5: the trail AuditMutationsInterceptor writes to, on the routes that attach it.
  { provide: AUDIT_MUTATION_SINK, useClass: CrmAuditSink },
  // HD-18: customer reminders n8n triggers.
  CustomerReminderService,
  { provide: CRM_TOKENS.CustomerReminderSource, useClass: CustomerReminderSourceHttpAdapter },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  { provide: APP_GUARD, useClass: DepotScopeGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [
    AiCampaignController,
    AiDraftController,
    CampaignController,
    SavedSegmentController,
    NotificationController,
    VisitNoticeController,
    PartnerBillNoticeController,
    NotificationExternalController,
    BroadcastController,
    PushController,
  ],
  providers,
  exports: [PrismaService, CrmConfigService],
})
export class CampaignModule {}
