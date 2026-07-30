// HRIS Lite web types + pure helpers. Mirrors hr-service Prisma models / DTOs; the
// server stays authority. Types live here (not types.ts) to keep the HR surface self-contained.

export type EmploymentStatus = 'TRAINING' | 'PROBATION' | 'PERMANENT' | 'DEPOT_MANAGER';
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
  MALE: 'Laki-laki',
  FEMALE: 'Perempuan',
};

export const PTKP_STATUS_LABEL: Record<PtkpStatus, string> = {
  TK0: 'TK/0 — lajang',
  TK1: 'TK/1 — lajang, 1 tanggungan',
  TK2: 'TK/2 — lajang, 2 tanggungan',
  TK3: 'TK/3 — lajang, 3 tanggungan',
  K0: 'K/0 — menikah',
  K1: 'K/1 — menikah, 1 tanggungan',
  K2: 'K/2 — menikah, 2 tanggungan',
  K3: 'K/3 — menikah, 3 tanggungan',
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
  depotId: string;
  position: string;
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
}

export type LeaveType = 'ANNUAL' | 'SICK' | 'PERMISSION' | 'EMERGENCY';
export type LeaveStatus = 'PENDING_MANAGER' | 'PENDING_HR' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface LeaveRequest {
  id: string;
  employeeId: string;
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
  ANNUAL: 'Cuti tahunan',
  SICK: 'Sakit',
  PERMISSION: 'Izin',
  EMERGENCY: 'Darurat',
};
export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  PENDING_MANAGER: 'Menunggu atasan',
  PENDING_HR: 'Menunggu HR',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
  CANCELLED: 'Dibatalkan',
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
  fileUrl: string;
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
  KTP: 'KTP',
  KK: 'Kartu Keluarga',
  CONTRACT: 'Kontrak Kerja',
  NPWP: 'NPWP',
  CERTIFICATE: 'Sertifikat',
  OTHER: 'Lainnya',
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

export function departmentLabel(list: Department[], id: string | null | undefined): string {
  if (!id) return 'Belum diatur';
  const found = list.find((d) => d.id === id);
  return found ? `${found.code} · ${found.name}` : 'Belum diatur';
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

/** Sunday-first, matching Date.getUTCDay and the server's pattern keys. */
export const WEEKDAY_LABEL = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

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

export const BONUS_METRIC_LABEL: Record<BonusMetric, string> = {
  ATTENDANCE_RATE: 'Tingkat kehadiran (%)',
  PRESENT_DAYS: 'Jumlah hari hadir',
  ZERO_LATE: 'Tanpa terlambat (1=ya)',
  IS_DEPOT_MANAGER: 'Kepala Depot (1=ya)',
  SALES_TOTAL: 'Total penjualan depot (Rp)',
};
export const COMPARE_OP_LABEL: Record<CompareOp, string> = { GTE: '≥', LTE: '≤', EQ: '=' };
export const REWARD_KIND_LABEL: Record<RewardKind, string> = {
  FIXED: 'Nominal (Rp)',
  PERCENT: '% dari gaji pokok',
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
}
export interface SettingsSchema {
  defs: SettingDef[];
  effective: Record<string, string | number | boolean>;
}

// --- labels (Indonesian, matching the ops console tone) ---
export const EMPLOYMENT_STATUS_LABEL: Record<EmploymentStatus, string> = {
  TRAINING: 'Training',
  PROBATION: 'Percobaan',
  PERMANENT: 'Tetap',
  DEPOT_MANAGER: 'Kepala Depot',
};
export const EMPLOYEE_STATUS_LABEL: Record<EmployeeStatus, string> = {
  ACTIVE: 'Aktif',
  INACTIVE: 'Nonaktif',
  RESIGNED: 'Resign',
};
export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  PRESENT: 'Hadir',
  LATE: 'Terlambat',
  ABSENT: 'Absen',
  LEAVE: 'Cuti',
  HOLIDAY: 'Libur',
  // Offline punch that synced too late to trust its device clock; counts as nothing until HR decides.
  PENDING: 'Menunggu persetujuan',
};
export const PAYROLL_STATUS_LABEL: Record<PayrollStatus, string> = {
  DRAFT: 'Draft',
  APPROVED: 'Disetujui',
  PAID: 'Dibayar',
};
export const ALLOWANCE_TYPES: AllowanceType[] = [
  'TRANSPORT',
  'MEAL',
  'POSITION',
  'HOUSING',
  'OTHER',
];
export const ALLOWANCE_TYPE_LABEL: Record<AllowanceType, string> = {
  TRANSPORT: 'Transport',
  MEAL: 'Makan',
  POSITION: 'Jabatan',
  HOUSING: 'Perumahan',
  OTHER: 'Lainnya',
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
  MOTORCYCLE: 'Motor',
  SMARTPHONE: 'Ponsel',
  UNIFORM: 'Seragam',
  LAPTOP: 'Laptop',
  PRINTER: 'Printer',
  SCANNER: 'Scanner',
  OTHER: 'Lainnya',
};
export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  AVAILABLE: 'Tersedia',
  ASSIGNED: 'Dipegang',
  RETURNED: 'Dikembalikan',
  MAINTENANCE: 'Perbaikan',
  LOST: 'Hilang',
};
export const ASSET_MOVEMENT_LABEL: Record<AssetMovementKind, string> = {
  ASSIGN: 'Serah terima',
  TRANSFER: 'Pindah tangan',
  RETURN: 'Pengembalian',
  MAINTENANCE: 'Masuk perbaikan',
  LOST: 'Dinyatakan hilang',
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
  INFO: 'Informasi',
  WARNING: 'Perhatian',
  URGENT: 'Mendesak',
};
export const ANNOUNCEMENT_DIMENSIONS: AnnouncementDimension[] = [
  'COMPANY',
  'DEPOT',
  'DEPARTMENT',
  'POSITION',
  'EMPLOYEE',
];
export const ANNOUNCEMENT_DIMENSION_LABEL: Record<AnnouncementDimension, string> = {
  COMPANY: 'Seluruh perusahaan',
  DEPOT: 'Depot',
  DEPARTMENT: 'Departemen',
  POSITION: 'Jabatan',
  EMPLOYEE: 'Karyawan tertentu',
};

/** Everything except COMPANY names a specific thing, so it needs a value. */
export function announcementTargetNeedsValue(dimension: AnnouncementDimension): boolean {
  return dimension !== 'COMPANY';
}

/** "12 dari 40 dibaca (30%)". Zero audience reads as "—", not a division by zero. */
export function announcementReadRate(readCount: number, audienceSize: number): string {
  if (audienceSize <= 0) return '—';
  return `${readCount} dari ${audienceSize} dibaca (${Math.round((readCount / audienceSize) * 100)}%)`;
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
    : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** ISO datetime → "13.05". Empty-safe. */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

/** Current period as YYYY-MM. */
export function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Completed full years of service since joinDate (mirrors hr-service tenure math). "—" if invalid. */
export function tenureLabel(joinDate: string | null | undefined, asOf: Date = new Date()): string {
  if (!joinDate) return '—';
  const join = new Date(joinDate);
  if (Number.isNaN(join.getTime())) return '—';
  let years = asOf.getUTCFullYear() - join.getUTCFullYear();
  const before =
    asOf.getUTCMonth() < join.getUTCMonth() ||
    (asOf.getUTCMonth() === join.getUTCMonth() && asOf.getUTCDate() < join.getUTCDate());
  if (before) years--;
  years = Math.max(0, years);
  return `${years} tahun`;
}

// --- employee form ---
export interface EmployeeForm {
  fullName: string;
  phone: string;
  email: string;
  depotId: string;
  position: string;
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
}

export const EMPTY_EMPLOYEE_FORM: EmployeeForm = {
  fullName: '',
  phone: '',
  email: '',
  depotId: '',
  position: '',
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
};

export function employeeToForm(e: Employee): EmployeeForm {
  return {
    fullName: e.fullName,
    phone: e.phone,
    email: e.email ?? '',
    depotId: e.depotId,
    position: e.position,
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
  };
}

/** Validate + coerce the string form into an API payload, mirroring CreateEmployeeDto. */
export function toEmployeePayload(
  f: EmployeeForm,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const req = {
    fullName: f.fullName.trim(),
    phone: f.phone.trim(),
    depotId: f.depotId.trim(),
    position: f.position.trim(),
    joinDate: f.joinDate.trim(),
  };
  for (const [k, v] of Object.entries(req))
    if (!v) return { ok: false, error: `${k} wajib diisi.` };
  const daily = Number(f.dailyRate);
  const monthly = Number(f.monthlyRate);
  if (f.salaryType === 'DAILY' && !(daily > 0))
    return { ok: false, error: 'Gaji harian (dailyRate) wajib > 0.' };
  if (f.salaryType === 'MONTHLY' && !(monthly > 0))
    return { ok: false, error: 'Gaji bulanan (monthlyRate) wajib > 0.' };
  const value: Record<string, unknown> = {
    ...req,
    employmentStatus: f.employmentStatus,
    salaryType: f.salaryType,
    joinDate: new Date(f.joinDate).toISOString(),
  };
  if (f.email.trim()) value.email = f.email.trim();
  if (f.salaryType === 'DAILY') value.dailyRate = daily;
  else value.monthlyRate = monthly;
  if (f.bankName.trim()) value.bankName = f.bankName.trim();
  if (f.bankAccount.trim()) value.bankAccount = f.bankAccount.trim();
  if (f.emergencyName.trim()) value.emergencyName = f.emergencyName.trim();
  if (f.emergencyPhone.trim()) value.emergencyPhone = f.emergencyPhone.trim();
  if (f.supervisorId.trim()) value.supervisorId = f.supervisorId.trim();
  if (f.departmentId.trim()) value.departmentId = f.departmentId.trim();
  if (f.npwp.trim()) value.npwp = f.npwp.trim();
  if (f.bpjsKes.trim()) value.bpjsKes = f.bpjsKes.trim();
  if (f.bpjsTk.trim()) value.bpjsTk = f.bpjsTk.trim();
  const nik = f.nik.replace(/\s/g, '');
  if (nik) {
    if (!/^\d{16}$/.test(nik)) return { ok: false, error: 'NIK harus 16 digit angka.' };
    value.nik = nik;
  }
  if (f.birthDate.trim()) value.birthDate = new Date(f.birthDate).toISOString();
  if (f.gender) value.gender = f.gender;
  if (f.address.trim()) value.address = f.address.trim();
  if (f.ptkpStatus) value.ptkpStatus = f.ptkpStatus;
  if (f.contractEndDate.trim()) {
    if (f.contractEndDate < f.joinDate) {
      return { ok: false, error: 'Akhir kontrak tidak boleh sebelum tanggal masuk.' };
    }
    value.contractEndDate = new Date(f.contractEndDate).toISOString();
  }
  return { ok: true, value };
}
