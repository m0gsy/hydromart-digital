// GENERATED (audit D-6) — mirrors of the shapes these routes already return.
// Regenerate rather than hand-edit: the point is that the documented schema cannot
// drift from the response. No field is added, removed or renamed here.
import { ApiProperty } from '@nestjs/swagger';

/** Mirrors `AnnouncementWithTargets` exactly — generated for audit D-6, no field added or removed. */
export class AnnouncementWithTargetsResponseDto {
  @ApiProperty({ type: [Object] })
  targets!: unknown[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class PublishDueResponseDto {
  @ApiProperty({ type: Number })
  published!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class MarkReadResponseDto {
  @ApiProperty({ type: String, format: 'date-time' })
  readAt!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class ListResponseDto {
  @ApiProperty({ type: [Object] })
  rows!: unknown[];
  @ApiProperty({ type: Number })
  total!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class ListSelfResponseDto {
  @ApiProperty({ type: [Object] })
  rows!: unknown[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  pageSize!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class List2ResponseDto {
  @ApiProperty({ type: [Object] })
  rows!: unknown[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  pageSize!: number;
}

/** Mirrors `PayrollWithItems` exactly — generated for audit D-6, no field added or removed. */
export class PayrollWithItemsResponseDto {
  @ApiProperty({ type: [Object] })
  items!: unknown[];
}

/** Mirrors `ScoreWeights` exactly — generated for audit D-6, no field added or removed. */
export class ScoreWeightsResponseDto {
  @ApiProperty({ type: Number })
  attendance!: number;
  @ApiProperty({ type: Number })
  discipline!: number;
  @ApiProperty({ type: Number })
  sales!: number;
}

/** Mirrors `PerformanceScore` exactly — generated for audit D-6, no field added or removed. */
export class PerformanceScoreResponseDto {
  @ApiProperty({ type: Number, nullable: true })
  attendance!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  discipline!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  sales!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  final!: number | null;
  @ApiProperty({ type: ScoreWeightsResponseDto })
  effectiveWeights!: ScoreWeightsResponseDto;
}

/** Mirrors `ScoreInputs` exactly — generated for audit D-6, no field added or removed. */
export class ScoreInputsResponseDto {
  @ApiProperty({ type: Number })
  presentDays!: number;
  @ApiProperty({ type: Number })
  lateDays!: number;
  @ApiProperty({ type: Number })
  workingDays!: number;
  @ApiProperty({ type: Number, nullable: true })
  salesTotal!: number | null;
  @ApiProperty({ type: Number })
  salesTarget!: number;
}

/** Mirrors `ScoredEmployee` exactly — generated for audit D-6, no field added or removed. */
export class ScoredEmployeeResponseDto {
  @ApiProperty({ type: String })
  employeeId!: string;
  @ApiProperty({ type: String })
  employeeCode!: string;
  @ApiProperty({ type: String })
  fullName!: string;
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ type: String })
  position!: string;
  @ApiProperty({ type: PerformanceScoreResponseDto })
  score!: PerformanceScoreResponseDto;
  @ApiProperty({ type: ScoreInputsResponseDto })
  inputs!: ScoreInputsResponseDto;
}

/** Mirrors `GroupCount` exactly — generated for audit D-6, no field added or removed. */
export class GroupCountResponseDto {
  @ApiProperty({ type: String })
  key!: string;
  @ApiProperty({ type: Number })
  count!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class HrDashboardHeadcountResponseDto {
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: [GroupCountResponseDto] })
  byStatus!: GroupCountResponseDto[];
  @ApiProperty({ type: [GroupCountResponseDto] })
  byEmploymentStatus!: GroupCountResponseDto[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class HrDashboardPayrollTotalsResponseDto {
  @ApiProperty({ type: Number })
  gross!: number;
  @ApiProperty({ type: Number })
  totalBonus!: number;
  @ApiProperty({ type: Number })
  totalDeduction!: number;
  @ApiProperty({ type: Number })
  net!: number;
  @ApiProperty({ type: Number })
  count!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class HrDashboardPayrollResponseDto {
  @ApiProperty({ type: HrDashboardPayrollTotalsResponseDto })
  totals!: HrDashboardPayrollTotalsResponseDto;
  @ApiProperty({ type: [GroupCountResponseDto] })
  byStatus!: GroupCountResponseDto[];
}

/** Mirrors `HrDashboard` exactly — generated for audit D-6, no field added or removed. */
export class HrDashboardResponseDto {
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ type: String })
  periodMonth!: string;
  @ApiProperty({ type: String })
  workDate!: string;
  @ApiProperty({ type: HrDashboardHeadcountResponseDto })
  headcount!: HrDashboardHeadcountResponseDto;
  @ApiProperty({ type: [GroupCountResponseDto] })
  attendanceToday!: GroupCountResponseDto[];
  @ApiProperty({ type: HrDashboardPayrollResponseDto })
  payroll!: HrDashboardPayrollResponseDto;
}

/** Mirrors `HrDepotSummary` exactly — generated for audit D-6, no field added or removed. */
export class HrDepotResponseDto {
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String })
  workDate!: string;
  @ApiProperty({ type: String })
  periodMonth!: string;
  @ApiProperty({ type: Number })
  lateToday!: number;
  @ApiProperty({ type: Number })
  absentToday!: number;
  @ApiProperty({ type: Number })
  presentToday!: number;
  @ApiProperty({ type: Number })
  payrollMtdNet!: number;
  @ApiProperty({ type: Number })
  activeHeadcount!: number;
}

/** Mirrors `LoanView` exactly — generated for audit D-6, no field added or removed. */
export class LoanResponseDto {
  @ApiProperty({ type: Number })
  remaining!: number;
  @ApiProperty({ type: Boolean })
  settled!: boolean;
}

/** Mirrors `SettingDef` exactly — generated for audit D-6, no field added or removed. */
export class SettingDefResponseDto {
  @ApiProperty({ type: String })
  key!: string;
  @ApiProperty({ type: String })
  label!: string;
  @ApiProperty({ type: Object })
  type!: unknown;
  @ApiProperty({ required: false, type: String })
  unit?: string;
  @ApiProperty({ required: false, type: Number })
  min?: number;
  @ApiProperty({ required: false, type: Number })
  max?: number;
  @ApiProperty({ type: Object })
  envDefault!: unknown;
  @ApiProperty({ required: false, type: Boolean })
  global?: boolean;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class SchemaResponseDto {
  @ApiProperty({ type: [SettingDefResponseDto] })
  defs!: SettingDefResponseDto[];
  @ApiProperty({ type: Object })
  effective!: unknown;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class PublishDue2ResponseDto {
  @ApiProperty({ type: Number })
  published!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class MarkRead2ResponseDto {
  @ApiProperty({ type: String, format: 'date-time' })
  readAt!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class List3ResponseDto {
  @ApiProperty({ type: [Object] })
  rows!: unknown[];
  @ApiProperty({ type: Number })
  total!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class ListSelf2ResponseDto {
  @ApiProperty({ type: [Object] })
  rows!: unknown[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  pageSize!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class PurgeResponseDto {
  @ApiProperty({ type: Number })
  deleted!: number;
  @ApiProperty({ type: Number })
  failed!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class RetentionReportResponseDto {
  @ApiProperty({ type: Number })
  eligible!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class RetentionAnonymiseResponseDto {
  @ApiProperty({ type: Number })
  deleted!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class List4ResponseDto {
  @ApiProperty({ type: [Object] })
  rows!: unknown[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  pageSize!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Schema2ResponseDto {
  @ApiProperty({ type: [SettingDefResponseDto] })
  defs!: SettingDefResponseDto[];
  @ApiProperty({ type: Object })
  effective!: unknown;
}

/** Mirrors the Prisma model `Bonus` (its scalar fields — audit D-6). */
export class BonusResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  employeeId!: string;
  @ApiProperty({ enum: ['ATTENDANCE', 'PERFORMANCE', 'SALES', 'DEPOT', 'MANUAL'] })
  type!: string;
  @ApiProperty({ type: String, description: 'decimal' })
  amount!: string;
  @ApiProperty({ type: String })
  periodMonth!: string;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ type: String, nullable: true })
  createdBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Mirrors the Prisma model `Deduction` (its scalar fields — audit D-6). */
export class DeductionResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  employeeId!: string;
  @ApiProperty({ enum: ['LATE', 'ABSENCE', 'MANUAL', 'CASH_ADVANCE', 'OTHER'] })
  type!: string;
  @ApiProperty({ type: String, description: 'decimal' })
  amount!: string;
  @ApiProperty({ type: String })
  periodMonth!: string;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ type: String, nullable: true })
  createdBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
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

/** Mirrors the Prisma model `Allowance` (its scalar fields — audit D-6). */
export class AllowanceResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  employeeId!: string;
  @ApiProperty({ enum: ['TRANSPORT', 'MEAL', 'POSITION', 'HOUSING', 'OTHER'] })
  type!: string;
  @ApiProperty({ type: String, description: 'decimal' })
  amount!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  effectiveFrom!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  effectiveTo!: string | null;
  @ApiProperty({ type: Boolean })
  active!: boolean;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ type: String, nullable: true })
  createdBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors the response of this route (`AnnouncementWithTargets & AnnouncementStats`). */
export class GetByIdResponseDto {
  @ApiProperty({ type: [Object] })
  targets!: unknown[];
  @ApiProperty({ type: Number })
  audienceSize!: number;
  @ApiProperty({ type: Number })
  readCount!: number;
}

/** Mirrors the Prisma model `EmployeeAsset` (its scalar fields — audit D-6). */
export class EmployeeAssetResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ enum: ['MOTORCYCLE', 'SMARTPHONE', 'UNIFORM', 'LAPTOP', 'PRINTER', 'SCANNER', 'OTHER'] })
  type!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String, nullable: true })
  brand!: string | null;
  @ApiProperty({ type: String, nullable: true })
  serialNo!: string | null;
  @ApiProperty({ type: String, description: 'decimal', nullable: true })
  value!: string | null;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ enum: ['AVAILABLE', 'ASSIGNED', 'RETURNED', 'MAINTENANCE', 'LOST'] })
  status!: string;
  @ApiProperty({ type: String, nullable: true })
  holderId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors the Prisma model `Attendance` (its scalar fields — audit D-6). */
export class AttendanceResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  employeeId!: string;
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  workDate!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  checkInAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  checkOutAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  checkInPhotoUrl!: string | null;
  @ApiProperty({ type: String, nullable: true })
  checkOutPhotoUrl!: string | null;
  @ApiProperty({ type: Number, nullable: true })
  checkInScore!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  checkOutScore!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  checkInLat!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  checkInLng!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  checkOutLat!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  checkOutLng!: number | null;
  @ApiProperty({ type: Number })
  lateMinutes!: number;
  @ApiProperty({ type: Number, nullable: true })
  workingMinutes!: number | null;
  @ApiProperty({ enum: ['PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'HOLIDAY', 'PENDING'] })
  status!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors the Prisma model `Holiday` (its scalar fields — audit D-6). */
export class HolidayResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  date!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Mirrors the Prisma model `Shift` (its scalar fields — audit D-6). */
export class ShiftResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  startTime!: string;
  @ApiProperty({ type: String })
  endTime!: string;
  @ApiProperty({ type: Boolean })
  active!: boolean;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors the Prisma model `ShiftRotation` (its scalar fields — audit D-6). */
export class ShiftRotationResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ type: Object })
  pattern!: unknown;
  @ApiProperty({ type: Boolean })
  active!: boolean;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors the Prisma model `ShiftAssignment` (its scalar fields — audit D-6). */
export class ShiftAssignmentResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  employeeId!: string;
  @ApiProperty({ type: String, nullable: true })
  shiftId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  rotationId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  effectiveFrom!: string;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ type: String, nullable: true })
  createdBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Mirrors the Prisma model `Department` (its scalar fields — audit D-6). */
export class DepartmentResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ type: Boolean })
  active!: boolean;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors the Prisma model `EmployeeDocument` (its scalar fields — audit D-6). */
export class EmployeeDocumentResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  employeeId!: string;
  @ApiProperty({ enum: ['KTP', 'KK', 'CONTRACT', 'NPWP', 'CERTIFICATE', 'OTHER'] })
  type!: string;
  // SEC-01: `fileUrl` and `fileKey` are deliberately NOT here. They are where the file
  // lives, the route serves the bytes instead, and this schema documents what a client
  // actually receives — see DocumentView. Hand-edited for that reason.
  @ApiProperty({ type: String })
  mimeType!: string;
  @ApiProperty({ type: Number })
  sizeBytes!: number;
  @ApiProperty({ type: Number })
  version!: number;
  @ApiProperty({ type: String, nullable: true })
  supersededById!: string | null;
  @ApiProperty({ type: String, nullable: true })
  uploadedBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiresAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Mirrors the Prisma model `Employee` (its scalar fields — audit D-6). */
export class EmployeeResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  employeeCode!: string;
  @ApiProperty({ type: String, nullable: true })
  authSubjectId!: string | null;
  @ApiProperty({ type: String })
  fullName!: string;
  @ApiProperty({ type: String, nullable: true })
  photoUrl!: string | null;
  @ApiProperty({ type: String })
  phone!: string;
  @ApiProperty({ type: String, nullable: true })
  email!: string | null;
  @ApiProperty({ type: String, nullable: true })
  nik!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  birthDate!: string | null;
  @ApiProperty({ enum: ['MALE', 'FEMALE'], nullable: true })
  gender!: string | null;
  @ApiProperty({ type: String, nullable: true })
  address!: string | null;
  @ApiProperty({ enum: ['TK0', 'TK1', 'TK2', 'TK3', 'K0', 'K1', 'K2', 'K3'], nullable: true })
  ptkpStatus!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  contractEndDate!: string | null;
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ type: String })
  position!: string;
  @ApiProperty({ enum: ['CUSTOMER', 'STAFF_DEPOT', 'KEPALA_DEPOT', 'ASSISTANT_SUPERVISOR', 'SUPERVISOR', 'MANAGER', 'DIREKTUR', 'FRANCHISE_OWNER', 'HEAD_OFFICE', 'FINANCE', 'MARKETING', 'HR', 'SUPER_ADMIN'], nullable: true })
  role!: string | null;
  @ApiProperty({ enum: ['TRAINING', 'PROBATION', 'PERMANENT'] })
  employmentStatus!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  joinDate!: string;
  @ApiProperty({ type: String, nullable: true })
  supervisorId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  shiftId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  departmentId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  npwp!: string | null;
  @ApiProperty({ type: String, nullable: true })
  bpjsKes!: string | null;
  @ApiProperty({ type: String, nullable: true })
  bpjsTk!: string | null;
  @ApiProperty({ enum: ['DAILY', 'MONTHLY'] })
  salaryType!: string;
  @ApiProperty({ type: String, description: 'decimal', nullable: true })
  dailyRate!: string | null;
  @ApiProperty({ type: String, description: 'decimal', nullable: true })
  monthlyRate!: string | null;
  @ApiProperty({ type: String, nullable: true })
  bankName!: string | null;
  @ApiProperty({ type: String, nullable: true })
  bankAccount!: string | null;
  @ApiProperty({ type: String, nullable: true })
  emergencyName!: string | null;
  @ApiProperty({ type: String, nullable: true })
  emergencyPhone!: string | null;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE', 'RESIGNED'] })
  status!: string;
  @ApiProperty({ type: String, nullable: true })
  createdBy!: string | null;
  @ApiProperty({ type: String, nullable: true })
  updatedBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors the Prisma model `EmploymentHistory` (its scalar fields — audit D-6). */
export class EmploymentHistoryResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  employeeId!: string;
  @ApiProperty({ type: String })
  changeType!: string;
  @ApiProperty({ type: Object, nullable: true })
  fromValue!: unknown | null;
  @ApiProperty({ type: Object, nullable: true })
  toValue!: unknown | null;
  @ApiProperty({ type: String, format: 'date-time' })
  effectiveDate!: string;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ type: String, nullable: true })
  createdBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Mirrors the Prisma model `FaceEmbedding` (its scalar fields — audit D-6). */
export class FaceEmbeddingResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  employeeId!: string;
  @ApiProperty({ type: [Number] })
  vector!: number[];
  @ApiProperty({ type: Number })
  quality!: number;
  @ApiProperty({ type: String, nullable: true })
  sourcePhotoUrl!: string | null;
  @ApiProperty({ type: Boolean })
  active!: boolean;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Mirrors the Prisma model `LeaveBalance` (its scalar fields — audit D-6). */
export class LeaveBalanceResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  employeeId!: string;
  @ApiProperty({ type: Number })
  year!: number;
  @ApiProperty({ type: Number })
  quotaDays!: number;
  @ApiProperty({ type: Number })
  usedDays!: number;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors the Prisma model `LeaveRequest` (its scalar fields — audit D-6). */
export class LeaveRequestResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  employeeId!: string;
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ enum: ['ANNUAL', 'SICK', 'PERMISSION', 'EMERGENCY'] })
  type!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  startDate!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  endDate!: string;
  @ApiProperty({ type: Number })
  workingDays!: number;
  @ApiProperty({ type: String })
  reason!: string;
  @ApiProperty({ type: String, nullable: true })
  attachmentUrl!: string | null;
  @ApiProperty({ enum: ['PENDING_MANAGER', 'PENDING_HR', 'APPROVED', 'REJECTED', 'CANCELLED'] })
  status!: string;
  @ApiProperty({ type: String, nullable: true })
  managerDecidedBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  managerDecidedAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  hrDecidedBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  hrDecidedAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  decisionNote!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors the Prisma model `PerformanceReview` (its scalar fields — audit D-6). */
export class PerformanceReviewResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  employeeId!: string;
  @ApiProperty({ type: String })
  periodMonth!: string;
  @ApiProperty({ type: String, description: 'decimal' })
  score!: string;
  @ApiProperty({ type: String, description: 'decimal', nullable: true })
  attendanceScore!: string | null;
  @ApiProperty({ type: String, description: 'decimal', nullable: true })
  disciplineScore!: string | null;
  @ApiProperty({ type: String, description: 'decimal', nullable: true })
  salesScore!: string | null;
  @ApiProperty({ type: Object })
  metrics!: unknown;
  @ApiProperty({ type: String, nullable: true })
  reviewerId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ type: String, nullable: true })
  managerNote!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors the Prisma model `BonusRule` (its scalar fields — audit D-6). */
export class BonusRuleResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ enum: ['ATTENDANCE', 'PERFORMANCE', 'SALES', 'DEPOT', 'MANUAL'] })
  bonusType!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  metric!: string;
  @ApiProperty({ type: String })
  op!: string;
  @ApiProperty({ type: String, description: 'decimal' })
  threshold!: string;
  @ApiProperty({ type: String })
  rewardKind!: string;
  @ApiProperty({ type: String, description: 'decimal' })
  rewardValue!: string;
  @ApiProperty({ type: Boolean })
  active!: boolean;
  @ApiProperty({ type: String, nullable: true })
  createdBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class PublishDue3ResponseDto {
  @ApiProperty({ type: Number })
  published!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class MarkRead3ResponseDto {
  @ApiProperty({ type: String, format: 'date-time' })
  readAt!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class List5ResponseDto {
  @ApiProperty({ type: [Object] })
  rows!: unknown[];
  @ApiProperty({ type: Number })
  total!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class ListSelf3ResponseDto {
  @ApiProperty({ type: [Object] })
  rows!: unknown[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  pageSize!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Purge2ResponseDto {
  @ApiProperty({ type: Number })
  deleted!: number;
  @ApiProperty({ type: Number })
  failed!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class RetentionReport2ResponseDto {
  @ApiProperty({ type: Number })
  eligible!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class RetentionAnonymise2ResponseDto {
  @ApiProperty({ type: Number })
  deleted!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class List6ResponseDto {
  @ApiProperty({ type: [Object] })
  rows!: unknown[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  pageSize!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Schema3ResponseDto {
  @ApiProperty({ type: [SettingDefResponseDto] })
  defs!: SettingDefResponseDto[];
  @ApiProperty({ type: Object })
  effective!: unknown;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class ProvisionRowResultResponseDto {
  @ApiProperty({ type: Number })
  index!: number;
  @ApiProperty({ type: Boolean })
  ok!: boolean;
  @ApiProperty({ type: String, nullable: true })
  message!: string | null;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class ProvisionMany2ResponseDto {
  @ApiProperty({ type: [ProvisionRowResultResponseDto] })
  results!: ProvisionRowResultResponseDto[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class SetActive2ResponseDto {
  @ApiProperty({ type: Boolean })
  updated!: boolean;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class AnonymiseByAccountResponseDto {
  @ApiProperty({ type: Number })
  anonymised!: number;
}
