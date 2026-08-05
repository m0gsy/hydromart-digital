// GENERATED (audit D-6) — mirrors of the shapes these routes already return.
// Regenerate rather than hand-edit: the point is that the documented schema cannot
// drift from the response. No field is added, removed or renamed here.
import { ApiProperty } from '@nestjs/swagger';

/** Mirrors `AccessMatrixView` exactly — generated for audit D-6, no field added or removed. */
export class AccessMatrixResponseDto {
  @ApiProperty({ type: Object })
  defaults!: unknown;
  @ApiProperty({ type: Object })
  overrides!: unknown;
  @ApiProperty({ type: Object })
  effective!: unknown;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class InternalOverridesResponseDto {
  @ApiProperty({ type: Object })
  overrides!: unknown;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class ListStaffResponseDto {
  @ApiProperty({ type: [Object] })
  items!: unknown[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  limit!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class CountCustomersResponseDto {
  @ApiProperty({ type: Number })
  count!: number;
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String, nullable: true })
  to!: string | null;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class ListResponseDto {
  @ApiProperty({ type: [Object] })
  items!: unknown[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  limit!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class IngestResponseDto {
  @ApiProperty({ type: Boolean })
  recorded!: boolean;
}

/** Mirrors `DataExport` exactly — generated for audit D-6, no field added or removed. */
export class DataExportResponseDto {
  @ApiProperty({ type: String })
  exportedAt!: string;
  @ApiProperty({ type: Object })
  account!: unknown;
  @ApiProperty({ type: [Object] })
  consents!: unknown[];
  @ApiProperty({ type: Object })
  customer!: unknown;
  @ApiProperty({ type: [String] })
  notIncluded!: string[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class ApproveResponseDto {
  @ApiProperty({ type: Object })
  request!: unknown;
  @ApiProperty({ required: false, type: DataExportResponseDto })
  export?: DataExportResponseDto;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class PurgeAuditLogsResponseDto {
  @ApiProperty({ type: Number })
  deleted!: number;
}

/** Mirrors `HealthStatus` exactly — generated for audit D-6, no field added or removed. */
export class HealthStatusResponseDto {
  @ApiProperty({ enum: ['ok', 'error'] })
  status!: string;
  @ApiProperty({ type: String })
  service!: string;
  @ApiProperty({ type: Object })
  checks!: unknown;
  @ApiProperty({ type: String })
  timestamp!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class InternalOverrides2ResponseDto {
  @ApiProperty({ type: Object })
  overrides!: unknown;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class ListStaff2ResponseDto {
  @ApiProperty({ type: [Object] })
  items!: unknown[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  limit!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class CountCustomers2ResponseDto {
  @ApiProperty({ type: Number })
  count!: number;
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String, nullable: true })
  to!: string | null;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class List2ResponseDto {
  @ApiProperty({ type: [Object] })
  items!: unknown[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  limit!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Ingest2ResponseDto {
  @ApiProperty({ type: Boolean })
  recorded!: boolean;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Approve2ResponseDto {
  @ApiProperty({ type: Object })
  request!: unknown;
  @ApiProperty({ required: false, type: DataExportResponseDto })
  export?: DataExportResponseDto;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class PurgeAuditLogs2ResponseDto {
  @ApiProperty({ type: Number })
  deleted!: number;
}

/** Mirrors `ImportRowResult` exactly — generated for audit D-6, no field added or removed. */
export class ImportRowResponseDto {
  @ApiProperty({ type: Number })
  row!: number;
  @ApiProperty({ type: Object })
  status!: unknown;
  @ApiProperty({ required: false, type: String })
  message?: string;
  @ApiProperty({ required: false, type: String })
  id?: string;
}

/** Mirrors `ImportSummary` exactly — generated for audit D-6, no field added or removed. */
export class ImportResponseDto {
  @ApiProperty({ type: Number })
  created!: number;
  @ApiProperty({ type: Number })
  updated!: number;
  @ApiProperty({ type: Number })
  skipped!: number;
  @ApiProperty({ type: Number })
  failed!: number;
  @ApiProperty({ type: [ImportRowResponseDto] })
  results!: ImportRowResponseDto[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class InternalOverrides3ResponseDto {
  @ApiProperty({ type: Object })
  overrides!: unknown;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class ListStaff3ResponseDto {
  @ApiProperty({ type: [Object] })
  items!: unknown[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  limit!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class CountCustomers3ResponseDto {
  @ApiProperty({ type: Number })
  count!: number;
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String, nullable: true })
  to!: string | null;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class List3ResponseDto {
  @ApiProperty({ type: [Object] })
  items!: unknown[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  limit!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Ingest3ResponseDto {
  @ApiProperty({ type: Boolean })
  recorded!: boolean;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Approve3ResponseDto {
  @ApiProperty({ type: Object })
  request!: unknown;
  @ApiProperty({ required: false, type: DataExportResponseDto })
  export?: DataExportResponseDto;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class PurgeAuditLogs3ResponseDto {
  @ApiProperty({ type: Number })
  deleted!: number;
}
