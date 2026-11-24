export const DELIVERY_TOKENS = {
  DeliveryRepository: Symbol('DeliveryRepository'),
  ShiftRepository: Symbol('ShiftRepository'),
  IncidentRepository: Symbol('IncidentRepository'),
  SettlementRepository: Symbol('SettlementRepository'),
  OrderCoordination: Symbol('OrderCoordination'),
  CashCollection: Symbol('CashCollection'),
  CourierPayout: Symbol('CourierPayout'),
  Rating: Symbol('Rating'),
  DepotLocation: Symbol('DepotLocation'),
  OrderPayment: Symbol('OrderPayment'),
  OrderLookup: Symbol('OrderLookup'),
  OpsNotifier: Symbol('OpsNotifier'),
  CustomerNotification: Symbol('CustomerNotification'),
  EventPublisher: Symbol('EventPublisher'),
  /** AAS-11: the raw HTTP send to admin-service; EventPublisher is the outbox in front of it. */
  EventTransport: Symbol('EventTransport'),
  EventOutbox: Symbol('EventOutbox'),
  Storage: Symbol('Storage'),
  /** HD-11: the count behind the AI web's "waiting for your decision". */
  PendingApprovalsReader: Symbol('PendingApprovalsReader'),
} as const;
