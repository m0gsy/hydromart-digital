// HRIS Lite web types + pure helpers. Mirrors hr-service Prisma models / DTOs; the
// server stays authority. Types live here (not types.ts) to keep the HR surface self-contained.

export type EmploymentStatus = 'TRAINING' | 'PROBATION' | 'PERMANENT' | 'DEPOT_MANAGER';
export type SalaryType = 'DAILY' | 'MONTHLY';
export type EmployeeStatus = 'ACTIVE' | 'INACTIVE' | 'RESIGNED';
export type AttendanceStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'LEAVE' | 'HOLIDAY';
export type PayrollStatus = 'DRAFT' | 'APPROVED' | 'PAID';
export type BonusType = 'ATTENDANCE' | 'PERFORMANCE' | 'SALES' | 'DEPOT' | 'MANUAL';
export type DeductionType = 'LATE' | 'ABSENCE' | 'MANUAL' | 'CASH_ADVANCE' | 'OTHER';
export type PayrollItemKind = 'BASE' | 'BONUS' | 'DEDUCTION' | 'ADJUSTMENT';

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
  metrics: Record<string, unknown>;
  note: string | null;
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
    totals: { gross: number; totalBonus: number; totalDeduction: number; net: number; count: number };
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
};
export const PAYROLL_STATUS_LABEL: Record<PayrollStatus, string> = {
  DRAFT: 'Draft',
  APPROVED: 'Disetujui',
  PAID: 'Dibayar',
};
export const BONUS_TYPES: BonusType[] = ['ATTENDANCE', 'PERFORMANCE', 'SALES', 'DEPOT', 'MANUAL'];
export const DEDUCTION_TYPES: DeductionType[] = ['LATE', 'ABSENCE', 'MANUAL', 'CASH_ADVANCE', 'OTHER'];

/** "2026-07-01" or ISO → "01 Jul 2026". Empty-safe. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** ISO datetime → "13.05". Empty-safe. */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

/** Current period as YYYY-MM. */
export function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
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
}

export const EMPTY_EMPLOYEE_FORM: EmployeeForm = {
  fullName: '', phone: '', email: '', depotId: '', position: '',
  employmentStatus: 'TRAINING', joinDate: '', salaryType: 'DAILY',
  dailyRate: '', monthlyRate: '', bankName: '', bankAccount: '', emergencyName: '', emergencyPhone: '',
};

export function employeeToForm(e: Employee): EmployeeForm {
  return {
    fullName: e.fullName, phone: e.phone, email: e.email ?? '', depotId: e.depotId, position: e.position,
    employmentStatus: e.employmentStatus, joinDate: e.joinDate.slice(0, 10), salaryType: e.salaryType,
    dailyRate: e.dailyRate ?? '', monthlyRate: e.monthlyRate ?? '',
    bankName: e.bankName ?? '', bankAccount: e.bankAccount ?? '',
    emergencyName: e.emergencyName ?? '', emergencyPhone: e.emergencyPhone ?? '',
  };
}

/** Validate + coerce the string form into an API payload, mirroring CreateEmployeeDto. */
export function toEmployeePayload(f: EmployeeForm): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const req = { fullName: f.fullName.trim(), phone: f.phone.trim(), depotId: f.depotId.trim(), position: f.position.trim(), joinDate: f.joinDate.trim() };
  for (const [k, v] of Object.entries(req)) if (!v) return { ok: false, error: `${k} wajib diisi.` };
  const daily = Number(f.dailyRate);
  const monthly = Number(f.monthlyRate);
  if (f.salaryType === 'DAILY' && (!(daily > 0))) return { ok: false, error: 'Gaji harian (dailyRate) wajib > 0.' };
  if (f.salaryType === 'MONTHLY' && (!(monthly > 0))) return { ok: false, error: 'Gaji bulanan (monthlyRate) wajib > 0.' };
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
  return { ok: true, value };
}
