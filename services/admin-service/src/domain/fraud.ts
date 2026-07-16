// Fraud & risk flag lifecycle (Design 15b). Mirrors the Prisma FraudEntityType / FraudLevel /
// FraudStatus enums but stays domain-local so application/domain code never imports the
// generated client.

export enum FraudEntityType {
  ORDER = 'ORDER',
  ACCOUNT = 'ACCOUNT',
}

export enum FraudLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum FraudStatus {
  OPEN = 'OPEN',
  REVIEWED = 'REVIEWED',
  BLOCKED = 'BLOCKED',
  CLEARED = 'CLEARED',
}
