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
} as const;
