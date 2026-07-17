// Recurrence of a scheduled report (Design 15c). Mirrors the Prisma ReportCadence enum
// but kept domain-local so application/domain code never imports the generated client.
export enum ReportCadence {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
}
