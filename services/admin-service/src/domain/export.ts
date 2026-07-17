// Export output format + job lifecycle (Design 13c / 15c). Mirror the Prisma ExportFormat
// / ExportStatus enums but stay domain-local so app/domain code never imports the client.

export enum ExportFormat {
  XLSX = 'XLSX',
  CSV = 'CSV',
  PDF = 'PDF',
}

export enum ExportStatus {
  PENDING = 'PENDING',
  DONE = 'DONE',
  FAILED = 'FAILED',
}
