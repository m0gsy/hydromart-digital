// Incident timeline lifecycle (Design 14c). Mirrors the Prisma IncidentSeverity /
// IncidentStatus enums but stays domain-local so application/domain code never imports the
// generated client.

export enum IncidentSeverity {
  CRITICAL = 'CRITICAL',
  WARNING = 'WARNING',
  INFO = 'INFO',
}

export enum IncidentStatus {
  ONGOING = 'ONGOING',
  RESOLVED = 'RESOLVED',
}
