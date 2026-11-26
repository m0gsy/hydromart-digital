export const CRM_TOKENS = {
  CampaignRepository: Symbol('CampaignRepository'),
  BroadcastRepository: Symbol('BroadcastRepository'),
  NotificationRepository: Symbol('NotificationRepository'),
  CustomerDirectory: Symbol('CustomerDirectory'),
  ActivitySegment: Symbol('ActivitySegment'),
  SavedSegmentRepository: Symbol('SavedSegmentRepository'),
  PushSubscriptionRepository: Symbol('PushSubscriptionRepository'),
  PushSender: Symbol('PushSender'),
  BroadcastDelivery: Symbol('BroadcastDelivery'),
  NotificationPreference: Symbol('NotificationPreference'),
  // F8: which staff an ops alert about a depot should wake.
  DepotStaff: Symbol('DepotStaff'),
  StaffPrefs: Symbol('StaffPrefs'),
  DepotOverseers: Symbol('DepotOverseers'),
  // Flow 6a: destination brakes, read fail-closed from admin-service's public flags.
  DestinationBrakes: Symbol('DestinationBrakes'),
  // Flow 6b: who holds a role, and what role an account holds (auth-service).
  ApproverDirectory: Symbol('ApproverDirectory'),
  // Owner rule 24 Nov 2026: the email channel of staff notifications (admin-service).
  StaffEmail: Symbol('StaffEmail'),
  // AI-9: what one account's approval queues hold (dashboard-service).
  PendingApprovals: Symbol('PendingApprovals'),
  // AI-7c: the names of the legal entities an AI access request names (depot-service).
  LegalEntityNames: Symbol('LegalEntityNames'),
  // HD-18: who the customer reminders are for (order-service, loyalty-service).
  CustomerReminderSource: Symbol('CustomerReminderSource'),
  // HD-15: the items due for service by days or water volume (depot-service).
  MaintenanceDue: Symbol('MaintenanceDue'),
  LegalEntityAudience: Symbol('LegalEntityAudience'),
} as const;
