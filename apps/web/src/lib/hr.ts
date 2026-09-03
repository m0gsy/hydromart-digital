// HRIS Lite web types + pure helpers. Mirrors hr-service Prisma models / DTOs; the
// server stays authority. Types live here (not types.ts) to keep the HR surface self-contained.

import type { HrManagedRole } from '@hydromart/access';
import type { TVars } from './locale-context';
import { BUSINESS_TZ } from './wib';

/**
 * The `t` from `useT()`. PR-8: the label maps below hold dictionary KEYS, not Indonesian,
 * so the handful of helpers that build a sentence out of them need the translator passed
 * in — these are plain functions, and a hook cannot be called from one.
 */
export type Translate = (key: string, vars?: TVars) => string;

// DEPOT_MANAGER is gone: it was a JABATAN wearing a status's clothes, which made "depot
// head" and "on probation" mutually exclusive. It now lives on `Employee.role`.
export type EmploymentStatus = 'TRAINING' | 'PROBATION' | 'PERMANENT';
export type SalaryType = 'DAILY' | 'MONTHLY';
export type EmployeeStatus = 'ACTIVE' | 'INACTIVE' | 'RESIGNED';
export type AttendanceStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'LEAVE' | 'HOLIDAY' | 'PENDING';
export type PayrollStatus = 'DRAFT' | 'APPROVED' | 'PAID';
export type BonusType = 'ATTENDANCE' | 'PERFORMANCE' | 'SALES' | 'DEPOT' | 'MANUAL';
export type DeductionType = 'LATE' | 'ABSENCE' | 'MANUAL' | 'CASH_ADVANCE' | 'OTHER';
export type PayrollItemKind = 'BASE' | 'BONUS' | 'DEDUCTION' | 'ADJUSTMENT' | 'ALLOWANCE';
export type AllowanceType = 'TRANSPORT' | 'MEAL' | 'POSITION' | 'HOUSING' | 'OTHER';
export type Gender = 'MALE' | 'FEMALE';
/** PPh 21 class: TK = single, K = married, digit = dependants. */
export type PtkpStatus = 'TK0' | 'TK1' | 'TK2' | 'TK3' | 'K0' | 'K1' | 'K2' | 'K3';

export const GENDER_LABEL: Record<Gender, string> = {
  MALE: 'hrFix.map.gender.MALE',
  FEMALE: 'hrFix.map.gender.FEMALE',
};

export const PTKP_STATUS_LABEL: Record<PtkpStatus, string> = {
  TK0: 'hrFix.map.ptkp.TK0',
  TK1: 'hrFix.map.ptkp.TK1',
  TK2: 'hrFix.map.ptkp.TK2',
  TK3: 'hrFix.map.ptkp.TK3',
  K0: 'hrFix.map.ptkp.K0',
  K1: 'hrFix.map.ptkp.K1',
  K2: 'hrFix.map.ptkp.K2',
  K3: 'hrFix.map.ptkp.K3',
};

export interface HrPage<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Employee {
  id: string;
  employeeCode: string;
  authSubjectId: string | null;
  fullName: string;
  photoUrl: string | null;
  phone: string;
  email: string | null;
  /** Null for staff above a single depot (Asisten SPV and up). */
  depotId: string | null;
  position: string;
  /** Login role (jabatan). Editing it re-roles the person's account too. */
  role: HrManagedRole | null;
  employmentStatus: EmploymentStatus;
  joinDate: string;
  salaryType: SalaryType;
  dailyRate: string | null;
  monthlyRate: string | null;
  bankName: string | null;
  bankAccount: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  supervisorId: string | null;
  shiftId: string | null;
  departmentId: string | null;
  npwp: string | null;
  bpjsKes: string | null;
  bpjsTk: string | null;
  nik: string | null;
  birthDate: string | null;
  gender: Gender | null;
  address: string | null;
  ptkpStatus: PtkpStatus | null;
  contractEndDate: string | null;
  /** Last paid day; payroll clamps the period to joinDate..exitDate. */
  exitDate: string | null;
  status: EmployeeStatus;
  createdAt: string;
  updatedAt: string;
}

export interface EmploymentHistory {
  id: string;
  employeeId: string;
  changeType: string;
  fromValue: { value?: string } | null;
  toValue: { value?: string; employmentStatus?: string; position?: string } | null;
  effectiveDate: string;
  note: string | null;
  createdAt: string;
}

export interface Attendance {
  id: string;
  employeeId: string;
  depotId: string;
  workDate: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  checkInScore: number | null;
  checkOutScore: number | null;
  lateMinutes: number;
  workingMinutes: number | null;
  status: AttendanceStatus;
  /**
   * CA-1-01: whose working day this is.
   *
   * The approval queue drew a date, two times and a lateness figure and no name anywhere,
   * so an HR officer decided on somebody's attendance without being told whose. Null only
   * for an employee whose record was anonymised under the retention policy — the same
   * shape `Payroll.employeeName` (PG-01) already carries.
   */
  employeeName?: string | null;
}

export interface PayrollItem {
  id: string;
  kind: PayrollItemKind;
  label: string;
  amount: string;
}

export interface Payroll {
  id: string;
  employeeId: string;
  /**
   * PG-01: whose wage this is. Null only for an employee whose record was anonymised by
   * retention — never blank because nobody asked. The queue used to show `employeeId` and
   * nothing else, so forty draft payslips were forty identical rows.
   */
  employeeName?: string | null;
  periodMonth: string;
  status: PayrollStatus;
  gross: string;
  totalBonus: string;
  totalDeduction: string;
  net: string;
  presentDays: number;
  approvedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  items?: PayrollItem[];
}

export interface Bonus {
  id: string;
  employeeId: string;
  type: BonusType;
  amount: string;
  periodMonth: string;
  note: string | null;
  createdAt: string;
}

export interface Deduction {
  id: string;
  employeeId: string;
  type: DeductionType;
  amount: string;
  periodMonth: string;
  note: string | null;
  createdAt: string;
}

export interface PerformanceReview {
  id: string;
  employeeId: string;
  periodMonth: string;
  score: string;
  /** Null = the component had nothing to measure that period, NOT a zero (C2). */
  attendanceScore: string | null;
  disciplineScore: string | null;
  salesScore: string | null;
  metrics: Record<string, unknown>;
  note: string | null;
  managerNote: string | null;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  ip: string | null;
  at: string;
  /**
   * CA-1-03: what the row actually changed.
   *
   * hr-service has written `before`/`after` on every audit entry since the trail shipped,
   * and the screen declared neither — so the one page that exists to answer "who changed
   * this, and to what?" showed an action verb, an entity name and a timestamp. Both halves
   * were already on the wire.
   *
   * Null on a CREATE (`before`) or a DELETE (`after`).
   */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/**
 * The fields an audit entry changed, as `key: before → after`.
 *
 * Compared over the union of both sides so a field that only appears on one of them — a
 * column added, a value cleared — is still reported. Values are stringified because an
 * audit row is read, not computed with.
 */
export function auditChanges(log: AuditLog): { key: string; from: string; to: string }[] {
  const before = (log.before ?? {}) as Record<string, unknown>;
  const after = (log.after ?? {}) as Record<string, unknown>;
  const show = (v: unknown): string =>
    v === undefined || v === null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((k) => show(before[k]) !== show(after[k]))
    .map((k) => ({ key: k, from: show(before[k]), to: show(after[k]) }));
}

export type LeaveType = 'ANNUAL' | 'SICK' | 'PERMISSION' | 'EMERGENCY';
export type LeaveStatus = 'PENDING_MANAGER' | 'PENDING_HR' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface LeaveRequest {
  id: string;
  employeeId: string;
  /** PG-06: whose leave this is. Null only when the record was anonymised by retention. */
  employeeName?: string | null;
  depotId: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  workingDays: number;
  reason: string;
  attachmentUrl: string | null;
  status: LeaveStatus;
  decisionNote: string | null;
  createdAt: string;
}

export interface LeaveBalance {
  id: string;
  employeeId: string;
  year: number;
  quotaDays: number;
  usedDays: number;
}

export const LEAVE_TYPES: LeaveType[] = ['ANNUAL', 'SICK', 'PERMISSION', 'EMERGENCY'];
export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  ANNUAL: 'hrFix.map.leaveType.ANNUAL',
  SICK: 'hrFix.map.leaveType.SICK',
  PERMISSION: 'hrFix.map.leaveType.PERMISSION',
  EMERGENCY: 'hrFix.map.leaveType.EMERGENCY',
};
export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  PENDING_MANAGER: 'hrFix.map.leaveStatus.PENDING_MANAGER',
  PENDING_HR: 'hrFix.map.leaveStatus.PENDING_HR',
  APPROVED: 'hrFix.map.leaveStatus.APPROVED',
  REJECTED: 'hrFix.map.leaveStatus.REJECTED',
  CANCELLED: 'hrFix.map.leaveStatus.CANCELLED',
};
/** Only ANNUAL and PERMISSION consume the yearly quota (mirrors domain/leave.ts). */
export function leaveDeductsQuota(type: LeaveType): boolean {
  return type === 'ANNUAL' || type === 'PERMISSION';
}

export type EmployeeDocumentType = 'KTP' | 'KK' | 'CONTRACT' | 'NPWP' | 'CERTIFICATE' | 'OTHER';

export interface EmployeeDocument {
  id: string;
  employeeId: string;
  type: EmployeeDocumentType;
  // SEC-01: no `fileUrl`. The server no longer hands out the storage address; the bytes
  // come from `endpoints.hr.employeeDocumentFile(id)` with the session attached.
  mimeType: string;
  sizeBytes: number;
  version: number;
  /** Non-null = a newer version replaced this one; the row is kept as history. */
  supersededById: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export const DOCUMENT_TYPES: EmployeeDocumentType[] = [
  'KTP',
  'KK',
  'CONTRACT',
  'NPWP',
  'CERTIFICATE',
  'OTHER',
];
export const DOCUMENT_TYPE_LABEL: Record<EmployeeDocumentType, string> = {
  KTP: 'hrFix.map.docType.KTP',
  KK: 'hrFix.map.docType.KK',
  CONTRACT: 'hrFix.map.docType.CONTRACT',
  NPWP: 'hrFix.map.docType.NPWP',
  CERTIFICATE: 'hrFix.map.docType.CERTIFICATE',
  OTHER: 'hrFix.map.docType.OTHER',
};

/** "1,2 MB" — bytes are not something an HR admin should have to read. */
export function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
  depotId: string | null;
}

export interface Shift {
  id: string;
  depotId: string | null;
  name: string;
  startTime: string;
  endTime: string;
  active: boolean;
}

/** Org unit. depotId null = network-wide (Keuangan, HR); otherwise it belongs to one depot. */
export interface Department {
  id: string;
  code: string;
  name: string;
  depotId: string | null;
  active: boolean;
}

/** A depot's staff may sit in its own department or in a network-wide one — never another depot's. */
export function departmentsForDepot(list: Department[], depotId: string): Department[] {
  return list.filter((d) => d.active && (d.depotId === null || d.depotId === depotId));
}

export function departmentLabel(
  list: Department[],
  id: string | null | undefined,
  t: Translate,
): string {
  if (!id) return t('hrFix.common.notSet');
  const found = list.find((d) => d.id === id);
  return found ? `${found.code} · ${found.name}` : t('hrFix.common.notSet');
}

export type BonusMetric =
  'ATTENDANCE_RATE' | 'PRESENT_DAYS' | 'ZERO_LATE' | 'IS_DEPOT_MANAGER' | 'SALES_TOTAL';
export type CompareOp = 'GTE' | 'LTE' | 'EQ';
export type RewardKind = 'FIXED' | 'PERCENT';

export interface BonusRule {
  id: string;
  depotId: string | null;
  bonusType: BonusType;
  name: string;
  metric: BonusMetric;
  op: CompareOp;
  threshold: string;
  rewardKind: RewardKind;
  rewardValue: string;
  active: boolean;
  createdAt: string;
}

export interface Loan {
  id: string;
  employeeId: string;
  principal: string;
  installmentAmount: string;
  startPeriod: string;
  note: string | null;
  active: boolean;
  createdAt: string;
}

/** Fixed recurring pay. Repeats every period until it lapses — unlike a one-period Bonus. */
export interface Allowance {
  id: string;
  employeeId: string;
  type: AllowanceType;
  amount: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
  note: string | null;
  createdAt: string;
}

export type AssetType =
  'MOTORCYCLE' | 'SMARTPHONE' | 'UNIFORM' | 'LAPTOP' | 'PRINTER' | 'SCANNER' | 'OTHER';
export type AssetStatus = 'AVAILABLE' | 'ASSIGNED' | 'RETURNED' | 'MAINTENANCE' | 'LOST';
export type AssetMovementKind = 'ASSIGN' | 'TRANSFER' | 'RETURN' | 'MAINTENANCE' | 'LOST';

/** Company property. `status`/`holderId` are the current state; the history is `movements`. */
export interface EmployeeAsset {
  id: string;
  code: string;
  type: AssetType;
  name: string;
  brand: string | null;
  serialNo: string | null;
  value: string | null;
  depotId: string;
  status: AssetStatus;
  holderId: string | null;
  note: string | null;
  createdAt: string;
}

export interface AssetMovement {
  id: string;
  assetId: string;
  kind: AssetMovementKind;
  fromEmployeeId: string | null;
  toEmployeeId: string | null;
  condition: string | null;
  note: string | null;
  movedAt: string;
}

export interface AssetDetail extends EmployeeAsset {
  movements: AssetMovement[];
}

/** Weekly rotation: which shift is worked on each weekday, 0 = Sunday. */
export interface ShiftRotation {
  id: string;
  name: string;
  depotId: string | null;
  pattern: Record<string, string | null>;
  active: boolean;
}

/** Append-only roster row: from this date the employee works this shift/rotation. */
export interface ShiftAssignment {
  id: string;
  employeeId: string;
  shiftId: string | null;
  rotationId: string | null;
  effectiveFrom: string;
  note: string | null;
  createdAt: string;
}

/** Sunday-first, matching Date.getUTCDay and the server's pattern keys. Resolve with `t()`. */
export const WEEKDAY_LABEL = [0, 1, 2, 3, 4, 5, 6].map((d) => `hrFix.map.weekday.${d}`);

/**
 * Which shift a rotation puts someone on for a weekday. Mirrors shiftIdForDay in
 * `services/hr-service/src/domain/shift-rotation.ts`: a missing key is a day off, never a
 * guess at the nearest shift.
 */
export function rotationShiftForDay(
  pattern: Record<string, string | null>,
  weekday: number,
): string | null {
  return pattern[String(weekday)] ?? null;
}

/** A component is null when the period held nothing to measure it against (C2). */
export interface PerformanceScore {
  attendance: number | null;
  discipline: number | null;
  sales: number | null;
  final: number | null;
  effectiveWeights: { attendance: number; discipline: number; sales: number };
}

export interface ScoredEmployee {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  depotId: string;
  position: string;
  score: PerformanceScore;
  inputs: {
    presentDays: number;
    lateDays: number;
    workingDays: number;
    salesTotal: number | null;
    salesTarget: number;
  };
}

/** "82,5" or "—". A null score is not a zero: nothing was measurable that period. */
export function fmtScore(score: number | null): string {
  return score === null ? '—' : score.toFixed(1).replace('.', ',');
}

export type AnnouncementLevel = 'INFO' | 'WARNING' | 'URGENT';
/**
 * The spec calls the fourth dimension "ROLE". hr-service holds no auth role — those live in
 * auth-service — so what HR can target is the jabatan, `Employee.position`.
 */
export type AnnouncementDimension = 'COMPANY' | 'DEPOT' | 'DEPARTMENT' | 'POSITION' | 'EMPLOYEE';

export interface AnnouncementTarget {
  id: string;
  dimension: AnnouncementDimension;
  value: string | null;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  level: AnnouncementLevel;
  scheduledAt: string | null;
  publishedAt: string | null;
  audienceSize: number;
  createdAt: string;
  targets: AnnouncementTarget[];
}

export interface AnnouncementDetail extends Announcement {
  readCount: number;
}

/** Loan + computed outstanding balance (server-derived, as of a period). */
export interface LoanView extends Loan {
  remaining: number;
  settled: boolean;
}

/**
 * CA-1-34: a loan on the network-wide list, which has to say WHOSE it is.
 *
 * The per-employee view never needed a name — you were already looking at the employee.
 * Null for a record anonymised under the retention policy.
 */
export interface LoanListView extends LoanView {
  employeeName: string | null;
  employeeCode: string | null;
}

export const BONUS_METRIC_LABEL: Record<BonusMetric, string> = {
  ATTENDANCE_RATE: 'hrFix.map.bonusMetric.ATTENDANCE_RATE',
  PRESENT_DAYS: 'hrFix.map.bonusMetric.PRESENT_DAYS',
  ZERO_LATE: 'hrFix.map.bonusMetric.ZERO_LATE',
  IS_DEPOT_MANAGER: 'hrFix.map.bonusMetric.IS_DEPOT_MANAGER',
  SALES_TOTAL: 'hrFix.map.bonusMetric.SALES_TOTAL',
};
export const COMPARE_OP_LABEL: Record<CompareOp, string> = { GTE: '≥', LTE: '≤', EQ: '=' };
export const REWARD_KIND_LABEL: Record<RewardKind, string> = {
  FIXED: 'hrFix.map.rewardKind.FIXED',
  PERCENT: 'hrFix.map.rewardKind.PERCENT',
};

export interface GroupCount {
  key: string;
  count: number;
}

export interface HrDashboard {
  depotId: string | null;
  periodMonth: string;
  workDate: string;
  headcount: { total: number; byStatus: GroupCount[]; byEmploymentStatus: GroupCount[] };
  attendanceToday: GroupCount[];
  payroll: {
    totals: {
      gross: number;
      totalBonus: number;
      totalDeduction: number;
      net: number;
      count: number;
    };
    byStatus: GroupCount[];
  };
}

export interface SettingDef {
  key: string;
  type: 'number' | 'string' | 'boolean';
  label?: string;
  min?: number;
  max?: number;
  /**
   * What the number or string actually means ("menit setelah jam masuk",
   * "telat1,telat2,tidakAbsen (Rp)"). The server has always sent it; dropping it here left
   * the CSV settings as a blank box nobody could guess the shape of.
   */
  unit?: string;
}
export interface SettingsSchema {
  defs: SettingDef[];
  effective: Record<string, string | number | boolean>;
}

// --- labels (Indonesian, matching the ops console tone) ---
export const EMPLOYMENT_STATUS_LABEL: Record<EmploymentStatus, string> = {
  TRAINING: 'hrFix.map.employmentStatus.TRAINING',
  PROBATION: 'hrFix.map.employmentStatus.PROBATION',
  PERMANENT: 'hrFix.map.employmentStatus.PERMANENT',
};
/** Jabatan labels for the roles HR may set. The office roles live in the staff console. */
export const HR_ROLE_LABEL: Record<HrManagedRole, string> = {
  STAFF_DEPOT: 'hrFix.map.role.STAFF_DEPOT',
  KEPALA_DEPOT: 'hrFix.map.role.KEPALA_DEPOT',
  ASSISTANT_SUPERVISOR: 'hrFix.map.role.ASSISTANT_SUPERVISOR',
  SUPERVISOR: 'hrFix.map.role.SUPERVISOR',
  MANAGER: 'hrFix.map.role.MANAGER',
};
export const EMPLOYEE_STATUS_LABEL: Record<EmployeeStatus, string> = {
  ACTIVE: 'hrFix.map.employeeStatus.ACTIVE',
  INACTIVE: 'hrFix.map.employeeStatus.INACTIVE',
  RESIGNED: 'hrFix.map.employeeStatus.RESIGNED',
};
export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  PRESENT: 'hrFix.map.attendance.PRESENT',
  LATE: 'hrFix.map.attendance.LATE',
  ABSENT: 'hrFix.map.attendance.ABSENT',
  LEAVE: 'hrFix.map.attendance.LEAVE',
  HOLIDAY: 'hrFix.map.attendance.HOLIDAY',
  // Offline punch that synced too late to trust its device clock; counts as nothing until HR decides.
  PENDING: 'hrFix.map.attendance.PENDING',
};
export const PAYROLL_STATUS_LABEL: Record<PayrollStatus, string> = {
  DRAFT: 'hrFix.map.payrollStatus.DRAFT',
  APPROVED: 'hrFix.map.payrollStatus.APPROVED',
  PAID: 'hrFix.map.payrollStatus.PAID',
};
export const ALLOWANCE_TYPES: AllowanceType[] = [
  'TRANSPORT',
  'MEAL',
  'POSITION',
  'HOUSING',
  'OTHER',
];
export const ALLOWANCE_TYPE_LABEL: Record<AllowanceType, string> = {
  TRANSPORT: 'hrFix.map.allowanceType.TRANSPORT',
  MEAL: 'hrFix.map.allowanceType.MEAL',
  POSITION: 'hrFix.map.allowanceType.POSITION',
  HOUSING: 'hrFix.map.allowanceType.HOUSING',
  OTHER: 'hrFix.map.allowanceType.OTHER',
};
export const ASSET_TYPES: AssetType[] = [
  'MOTORCYCLE',
  'SMARTPHONE',
  'UNIFORM',
  'LAPTOP',
  'PRINTER',
  'SCANNER',
  'OTHER',
];
export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  MOTORCYCLE: 'hrFix.map.assetType.MOTORCYCLE',
  SMARTPHONE: 'hrFix.map.assetType.SMARTPHONE',
  UNIFORM: 'hrFix.map.assetType.UNIFORM',
  LAPTOP: 'hrFix.map.assetType.LAPTOP',
  PRINTER: 'hrFix.map.assetType.PRINTER',
  SCANNER: 'hrFix.map.assetType.SCANNER',
  OTHER: 'hrFix.map.assetType.OTHER',
};
export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  AVAILABLE: 'hrFix.map.assetStatus.AVAILABLE',
  ASSIGNED: 'hrFix.map.assetStatus.ASSIGNED',
  RETURNED: 'hrFix.map.assetStatus.RETURNED',
  MAINTENANCE: 'hrFix.map.assetStatus.MAINTENANCE',
  LOST: 'hrFix.map.assetStatus.LOST',
};
export const ASSET_MOVEMENT_LABEL: Record<AssetMovementKind, string> = {
  ASSIGN: 'hrFix.map.assetMove.ASSIGN',
  TRANSFER: 'hrFix.map.assetMove.TRANSFER',
  RETURN: 'hrFix.map.assetMove.RETURN',
  MAINTENANCE: 'hrFix.map.assetMove.MAINTENANCE',
  LOST: 'hrFix.map.assetMove.LOST',
};

/**
 * Which movements the console offers for an asset in this state. Mirrors ASSET_TRANSITIONS in
 * `services/hr-service/src/domain/asset.ts` — the server still decides; this only stops the UI
 * from offering a button that is guaranteed to 409.
 */
export function assetMovesFrom(status: AssetStatus): AssetMovementKind[] {
  switch (status) {
    case 'AVAILABLE':
    case 'RETURNED':
      return ['ASSIGN', 'MAINTENANCE', 'LOST'];
    case 'ASSIGNED':
      return ['TRANSFER', 'RETURN', 'MAINTENANCE', 'LOST'];
    case 'MAINTENANCE':
      return ['RETURN', 'LOST'];
    case 'LOST':
      return [];
  }
}

/** Only these hand the item to a person, so only these need a recipient field. */
export function assetMoveNeedsRecipient(kind: AssetMovementKind): boolean {
  return kind === 'ASSIGN' || kind === 'TRANSFER';
}

export const ANNOUNCEMENT_LEVELS: AnnouncementLevel[] = ['INFO', 'WARNING', 'URGENT'];
export const ANNOUNCEMENT_LEVEL_LABEL: Record<AnnouncementLevel, string> = {
  INFO: 'hrFix.map.announceLevel.INFO',
  WARNING: 'hrFix.map.announceLevel.WARNING',
  URGENT: 'hrFix.map.announceLevel.URGENT',
};
export const ANNOUNCEMENT_DIMENSIONS: AnnouncementDimension[] = [
  'COMPANY',
  'DEPOT',
  'DEPARTMENT',
  'POSITION',
  'EMPLOYEE',
];
export const ANNOUNCEMENT_DIMENSION_LABEL: Record<AnnouncementDimension, string> = {
  COMPANY: 'hrFix.map.announceDim.COMPANY',
  DEPOT: 'hrFix.map.announceDim.DEPOT',
  DEPARTMENT: 'hrFix.map.announceDim.DEPARTMENT',
  POSITION: 'hrFix.map.announceDim.POSITION',
  EMPLOYEE: 'hrFix.map.announceDim.EMPLOYEE',
};

/** Everything except COMPANY names a specific thing, so it needs a value. */
export function announcementTargetNeedsValue(dimension: AnnouncementDimension): boolean {
  return dimension !== 'COMPANY';
}

/** "12 dari 40 dibaca (30%)". Zero audience reads as "—", not a division by zero. */
export function announcementReadRate(
  readCount: number,
  audienceSize: number,
  t: Translate,
): string {
  if (audienceSize <= 0) return '—';
  return t('hrFix.common.readRate', {
    read: readCount,
    total: audienceSize,
    pct: Math.round((readCount / audienceSize) * 100),
  });
}

export const BONUS_TYPES: BonusType[] = ['ATTENDANCE', 'PERFORMANCE', 'SALES', 'DEPOT', 'MANUAL'];
export const DEDUCTION_TYPES: DeductionType[] = [
  'LATE',
  'ABSENCE',
  'MANUAL',
  'CASH_ADVANCE',
  'OTHER',
];

/** "2026-07-01" or ISO → "01 Jul 2026". Empty-safe. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('id-ID', {
        timeZone: BUSINESS_TZ,
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
}

/** ISO datetime → "13.05". Empty-safe. */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString('id-ID', { timeZone: BUSINESS_TZ, hour: '2-digit', minute: '2-digit' });
}

/** Current period as YYYY-MM. */
export function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Completed full years of service since joinDate (mirrors hr-service tenure math). "—" if invalid. */
export function tenureLabel(
  joinDate: string | null | undefined,
  t: Translate,
  asOf: Date = new Date(),
): string {
  if (!joinDate) return '—';
  const join = new Date(joinDate);
  if (Number.isNaN(join.getTime())) return '—';
  let years = asOf.getUTCFullYear() - join.getUTCFullYear();
  const before =
    asOf.getUTCMonth() < join.getUTCMonth() ||
    (asOf.getUTCMonth() === join.getUTCMonth() && asOf.getUTCDate() < join.getUTCDate());
  if (before) years--;
  years = Math.max(0, years);
  return t('hrFix.common.years', { n: years });
}

// --- employee form ---
export interface EmployeeForm {
  fullName: string;
  phone: string;
  email: string;
  depotId: string;
  position: string;
  /** '' = leave the login role alone. Setting it re-roles the account. */
  role: HrManagedRole | '';
  employmentStatus: EmploymentStatus;
  joinDate: string;
  salaryType: SalaryType;
  dailyRate: string;
  monthlyRate: string;
  bankName: string;
  bankAccount: string;
  emergencyName: string;
  emergencyPhone: string;
  supervisorId: string;
  departmentId: string;
  npwp: string;
  bpjsKes: string;
  bpjsTk: string;
  nik: string;
  birthDate: string;
  gender: Gender | '';
  address: string;
  ptkpStatus: PtkpStatus | '';
  contractEndDate: string;
  /**
   * Last paid day. Blank = still employed. This is the field payroll stops at — `status`
   * alone does not end a wage — and nothing in the console could write it before.
   */
  exitDate: string;
  /** Lifecycle status; edit-only (a new hire is ACTIVE). */
  status: EmployeeStatus | '';
}

export const EMPTY_EMPLOYEE_FORM: EmployeeForm = {
  fullName: '',
  phone: '',
  email: '',
  depotId: '',
  position: '',
  role: '',
  employmentStatus: 'TRAINING',
  joinDate: '',
  salaryType: 'DAILY',
  dailyRate: '',
  monthlyRate: '',
  bankName: '',
  bankAccount: '',
  emergencyName: '',
  emergencyPhone: '',
  supervisorId: '',
  departmentId: '',
  npwp: '',
  bpjsKes: '',
  bpjsTk: '',
  nik: '',
  birthDate: '',
  gender: '',
  address: '',
  ptkpStatus: '',
  contractEndDate: '',
  exitDate: '',
  status: '',
};

export function employeeToForm(e: Employee): EmployeeForm {
  return {
    fullName: e.fullName,
    phone: e.phone,
    email: e.email ?? '',
    depotId: e.depotId ?? '',
    position: e.position,
    role: e.role ?? '',
    employmentStatus: e.employmentStatus,
    joinDate: e.joinDate.slice(0, 10),
    salaryType: e.salaryType,
    dailyRate: e.dailyRate ?? '',
    monthlyRate: e.monthlyRate ?? '',
    bankName: e.bankName ?? '',
    bankAccount: e.bankAccount ?? '',
    emergencyName: e.emergencyName ?? '',
    emergencyPhone: e.emergencyPhone ?? '',
    supervisorId: e.supervisorId ?? '',
    departmentId: e.departmentId ?? '',
    npwp: e.npwp ?? '',
    bpjsKes: e.bpjsKes ?? '',
    bpjsTk: e.bpjsTk ?? '',
    nik: e.nik ?? '',
    birthDate: e.birthDate?.slice(0, 10) ?? '',
    gender: e.gender ?? '',
    address: e.address ?? '',
    ptkpStatus: e.ptkpStatus ?? '',
    contractEndDate: e.contractEndDate?.slice(0, 10) ?? '',
    exitDate: e.exitDate?.slice(0, 10) ?? '',
    status: e.status,
  };
}

/** Validate + coerce the string form into an API payload, mirroring CreateEmployeeDto. */
export function toEmployeePayload(
  f: EmployeeForm,
  opts: { creating?: boolean; t: Translate },
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  // Adding an employee mints their login too, and an account cannot be minted without a
  // role. On edit it stays optional — "" means "leave the jabatan as it is", and rows
  // written before this release have none at all.
  if (opts.creating && !f.role) {
    return { ok: false, error: opts.t('hrFix.form.roleRequired') };
  }
  // Staff above a single depot (Asisten SPV and up) have no home depot — same rule the
  // server enforces, so the form does not demand a value the API would ignore.
  const aboveDepot =
    f.role === 'ASSISTANT_SUPERVISOR' || f.role === 'SUPERVISOR' || f.role === 'MANAGER';
  const req = {
    fullName: f.fullName.trim(),
    phone: f.phone.trim(),
    position: f.position.trim(),
    joinDate: f.joinDate.trim(),
    ...(aboveDepot ? {} : { depotId: f.depotId.trim() }),
  };
  for (const [k, v] of Object.entries(req))
    if (!v) return { ok: false, error: opts.t('hrFix.form.fieldRequired', { field: k }) };
  const daily = Number(f.dailyRate);
  const monthly = Number(f.monthlyRate);
  if (f.salaryType === 'DAILY' && !(daily > 0))
    return { ok: false, error: opts.t('hrFix.form.dailyRateRequired') };
  if (f.salaryType === 'MONTHLY' && !(monthly > 0))
    return { ok: false, error: opts.t('hrFix.form.monthlyRateRequired') };
  const value: Record<string, unknown> = {
    ...req,
    employmentStatus: f.employmentStatus,
    salaryType: f.salaryType,
    joinDate: new Date(f.joinDate).toISOString(),
  };
  if (f.role) value.role = f.role;
  if (f.email.trim()) value.email = f.email.trim();
  if (f.salaryType === 'DAILY') value.dailyRate = daily;
  else value.monthlyRate = monthly;
  if (f.bankName.trim()) value.bankName = f.bankName.trim();
  if (f.bankAccount.trim()) value.bankAccount = f.bankAccount.trim();
  if (f.emergencyName.trim()) value.emergencyName = f.emergencyName.trim();
  if (f.emergencyPhone.trim()) value.emergencyPhone = f.emergencyPhone.trim();
  // supervisorId is deliberately NOT sent any more: the reporting line lives in
  // depot-service's supervision table, written at /hq/hierarchy. The form field is gone,
  // and this stops an older cached form value from writing the column behind its back.
  if (f.departmentId.trim()) value.departmentId = f.departmentId.trim();
  if (f.npwp.trim()) value.npwp = f.npwp.trim();
  if (f.bpjsKes.trim()) value.bpjsKes = f.bpjsKes.trim();
  if (f.bpjsTk.trim()) value.bpjsTk = f.bpjsTk.trim();
  const nik = f.nik.replace(/\s/g, '');
  if (nik) {
    if (!/^\d{16}$/.test(nik)) return { ok: false, error: opts.t('hrFix.form.nikDigits') };
    value.nik = nik;
  }
  if (f.birthDate.trim()) value.birthDate = new Date(f.birthDate).toISOString();
  if (f.gender) value.gender = f.gender;
  if (f.address.trim()) value.address = f.address.trim();
  if (f.ptkpStatus) value.ptkpStatus = f.ptkpStatus;
  if (f.contractEndDate.trim()) {
    if (f.contractEndDate < f.joinDate) {
      return { ok: false, error: opts.t('hrFix.form.contractBeforeJoin') };
    }
    value.contractEndDate = new Date(f.contractEndDate).toISOString();
  }
  /*
   * Only on edit, and null when cleared.
   *
   * The exit date is what payroll clamps the paid period to, so leaving it behind on a
   * rehire pays the person for no days at all — which is why the cleared case sends an
   * explicit null instead of simply omitting the field.
   */
  if (!opts.creating) {
    if (f.exitDate.trim()) {
      if (f.exitDate < f.joinDate) {
        return { ok: false, error: opts.t('hrFix.form.exitBeforeJoin') };
      }
      value.exitDate = new Date(f.exitDate).toISOString();
    } else {
      value.exitDate = null;
    }
    if (f.status) value.status = f.status;
  }
  return { ok: true, value };
}
