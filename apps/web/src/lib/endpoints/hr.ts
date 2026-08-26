// Public path builders, one file per product area. The gateway strips the first
// segment and forwards the rest to the owning service, so every path is
// `/{segment}/api/v1/...`.
//
// Audit F-15: this used to be a single 1,426-line object literal imported by 232
// files — every route touched it, and every change to any path showed up as a
// conflict in the same file. Splitting it by area changes no path and no call site:
// `endpoints` is still one object, assembled in ./index.ts.

export const hr = {
// HRIS Lite (hr-service). Each public segment maps to HR_SERVICE_URL at the gateway,
// then hits the service's own /api/v1/... controller. Read = hrView; writes vary.
hr: {
  employees: (
    q: {
      depotId?: string;
      status?: string;
      departmentId?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) => {
    const p = new URLSearchParams();
    if (q.depotId) p.set('depotId', q.depotId);
    if (q.status) p.set('status', q.status);
    if (q.departmentId) p.set('departmentId', q.departmentId);
    if (q.search) p.set('search', q.search);
    if (q.page) p.set('page', String(q.page));
    if (q.pageSize) p.set('pageSize', String(q.pageSize));
    const qs = p.toString();
    return `/employees/api/v1/employees${qs ? `?${qs}` : ''}`;
  },
  employee: (id: string) => `/employees/api/v1/employees/${id}`,
  employeeHistory: (id: string) => `/employees/api/v1/employees/${id}/history`,
  createEmployee: '/employees/api/v1/employees',
  // POST: mint the login for an employee row that has none (hrAdmin, idempotent).
  // Backs the reconciliation badge on /hr/employees.
  createEmployeeAccount: (employeeId: string) =>
    `/employees/api/v1/employees/${employeeId}/account`,
  importEmployees: '/employees/api/v1/employees/import',
  updateEmployee: (id: string) => `/employees/api/v1/employees/${id}`,
  bonusRules: (depotId?: string) =>
    `/bonus-rules/api/v1/bonus-rules${depotId ? `?depotId=${encodeURIComponent(depotId)}` : ''}`,
  createBonusRule: '/bonus-rules/api/v1/bonus-rules',
  updateBonusRule: (id: string) => `/bonus-rules/api/v1/bonus-rules/${id}`,
  loans: (employeeId: string, asOfPeriod?: string) =>
    `/loans/api/v1/loans?employeeId=${employeeId}${asOfPeriod ? `&asOfPeriod=${asOfPeriod}` : ''}`,
  allowances: (employeeId: string) =>
    `/allowances/api/v1/allowances?employeeId=${encodeURIComponent(employeeId)}`,
  createAllowance: '/allowances/api/v1/allowances',
  importAllowances: '/allowances/api/v1/allowances/import',
  deactivateAllowance: (id: string) => `/allowances/api/v1/allowances/${id}/deactivate`,
  importDeductions: '/deductions/api/v1/deductions/import',
  createLoan: '/loans/api/v1/loans',
  importLoans: '/loans/api/v1/loans/import',
  deactivateLoan: (id: string) => `/loans/api/v1/loans/${id}/deactivate`,
  importLeaveBalances: '/leave/api/v1/leave/balances/import',
  importAssets: '/employee-assets/api/v1/employee-assets/import',
  enrollFace: (id: string) => `/employees/api/v1/employees/${id}/face/enroll`,
  enrollFaceMe: '/attendance/api/v1/attendance/me/face/enroll',
  checkIn: '/attendance/api/v1/attendance/check-in',
  checkOut: '/attendance/api/v1/attendance/check-out',
  attendanceManual: '/attendance/api/v1/attendance/manual',
  attendanceAdjust: (id: string) => `/attendance/api/v1/attendance/${id}/adjust`,
  attendanceDecide: (id: string) => `/attendance/api/v1/attendance/${id}/decide`,
  attendanceMe: (q: { from?: string; to?: string; page?: number; pageSize?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.from) p.set('from', q.from);
    if (q.to) p.set('to', q.to);
    if (q.page) p.set('page', String(q.page));
    if (q.pageSize) p.set('pageSize', String(q.pageSize));
    const qs = p.toString();
    return `/attendance/api/v1/attendance/me${qs ? `?${qs}` : ''}`;
  },
  payrollMe: (q: { periodMonth?: string; page?: number; pageSize?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.periodMonth) p.set('periodMonth', q.periodMonth);
    if (q.page) p.set('page', String(q.page));
    if (q.pageSize) p.set('pageSize', String(q.pageSize));
    const qs = p.toString();
    return `/payroll/api/v1/payroll/me${qs ? `?${qs}` : ''}`;
  },
  attendance: (
    q: {
      depotId?: string;
      employeeId?: string;
      status?: string;
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) => {
    const p = new URLSearchParams();
    if (q.depotId) p.set('depotId', q.depotId);
    if (q.employeeId) p.set('employeeId', q.employeeId);
    if (q.status) p.set('status', q.status);
    if (q.from) p.set('from', q.from);
    if (q.to) p.set('to', q.to);
    if (q.page) p.set('page', String(q.page));
    if (q.pageSize) p.set('pageSize', String(q.pageSize));
    const qs = p.toString();
    return `/attendance/api/v1/attendance${qs ? `?${qs}` : ''}`;
  },
  payroll: (
    q: {
      periodMonth?: string;
      employeeId?: string;
      status?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) => {
    const p = new URLSearchParams();
    if (q.periodMonth) p.set('periodMonth', q.periodMonth);
    if (q.employeeId) p.set('employeeId', q.employeeId);
    if (q.status) p.set('status', q.status);
    if (q.page) p.set('page', String(q.page));
    if (q.pageSize) p.set('pageSize', String(q.pageSize));
    const qs = p.toString();
    return `/payroll/api/v1/payroll${qs ? `?${qs}` : ''}`;
  },
  payrollById: (id: string) => `/payroll/api/v1/payroll/${id}`,
  /** One of MY OWN payslips. `payrollById` is hrView-gated; staff have no such capability. */
  payrollMeById: (id: string) => `/payroll/api/v1/payroll/me/${id}`,
  payrollMeSlip: (id: string) => `/payroll/api/v1/payroll/me/${id}/slip`,
  generatePayroll: '/payroll/api/v1/payroll/generate',
  approvePayroll: (id: string) => `/payroll/api/v1/payroll/${id}/approve`,
  payPayroll: (id: string) => `/payroll/api/v1/payroll/${id}/pay`,
  bonuses: (employeeId: string, periodMonth: string) =>
    `/bonuses/api/v1/bonuses?employeeId=${encodeURIComponent(employeeId)}&periodMonth=${encodeURIComponent(periodMonth)}`,
  createBonus: '/bonuses/api/v1/bonuses',
  deductions: (employeeId: string, periodMonth: string) =>
    `/deductions/api/v1/deductions?employeeId=${encodeURIComponent(employeeId)}&periodMonth=${encodeURIComponent(periodMonth)}`,
  createDeduction: '/deductions/api/v1/deductions',
  performance: (employeeId: string) =>
    `/performance/api/v1/performance?employeeId=${encodeURIComponent(employeeId)}`,
  createPerformance: '/performance/api/v1/performance',
  dashboard: (q: { depotId?: string; periodMonth?: string } = {}) => {
    const p = new URLSearchParams();
    if (q.depotId) p.set('depotId', q.depotId);
    if (q.periodMonth) p.set('periodMonth', q.periodMonth);
    const qs = p.toString();
    return `/hr-reports/api/v1/hr-reports/dashboard${qs ? `?${qs}` : ''}`;
  },
  reportEmployees: (depotId?: string, format?: string) => {
    const p = new URLSearchParams();
    if (depotId) p.set('depotId', depotId);
    if (format) p.set('format', format);
    const qs = p.toString();
    return `/hr-reports/api/v1/hr-reports/employees${qs ? `?${qs}` : ''}`;
  },
  reportAttendance: (from: string, to: string, depotId?: string, format?: string) => {
    const p = new URLSearchParams({ from, to });
    if (depotId) p.set('depotId', depotId);
    if (format) p.set('format', format);
    return `/hr-reports/api/v1/hr-reports/attendance?${p}`;
  },
  reportPayroll: (periodMonth: string, depotId?: string, format?: string) => {
    const p = new URLSearchParams({ periodMonth });
    if (depotId) p.set('depotId', depotId);
    if (format) p.set('format', format);
    return `/hr-reports/api/v1/hr-reports/payroll?${p}`;
  },
  payrollSlip: (id: string) => `/payroll/api/v1/payroll/${id}/slip`,
  audit: (
    q: {
      entity?: string;
      entityId?: string;
      actorId?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) => {
    const p = new URLSearchParams();
    if (q.entity) p.set('entity', q.entity);
    if (q.entityId) p.set('entityId', q.entityId);
    if (q.actorId) p.set('actorId', q.actorId);
    if (q.page) p.set('page', String(q.page));
    if (q.pageSize) p.set('pageSize', String(q.pageSize));
    const qs = p.toString();
    return `/hr-audit/api/v1/hr-audit${qs ? `?${qs}` : ''}`;
  },
  settingsSchema: (depotId?: string) =>
    `/hr/api/v1/hr/settings/schema${depotId ? `?depotId=${encodeURIComponent(depotId)}` : ''}`,
  putSetting: '/hr/api/v1/hr/settings',
  resetSetting: '/hr/api/v1/hr/settings',
  holidays: (q: { depotId?: string; from?: string; to?: string } = {}) => {
    const p = new URLSearchParams();
    if (q.depotId) p.set('depotId', q.depotId);
    if (q.from) p.set('from', q.from);
    if (q.to) p.set('to', q.to);
    const qs = p.toString();
    return `/holidays/api/v1/holidays${qs ? `?${qs}` : ''}`;
  },
  createHoliday: '/holidays/api/v1/holidays',
  deleteHoliday: (id: string) => `/holidays/api/v1/holidays/${id}`,
  shifts: (depotId?: string) =>
    `/hr-shifts/api/v1/hr-shifts${depotId ? `?depotId=${encodeURIComponent(depotId)}` : ''}`,
  departments: (depotId?: string) =>
    `/departments/api/v1/departments${depotId ? `?depotId=${encodeURIComponent(depotId)}` : ''}`,
  createDepartment: '/departments/api/v1/departments',
  updateDepartment: (id: string) => `/departments/api/v1/departments/${id}`,
  deleteDepartment: (id: string) => `/departments/api/v1/departments/${id}`,
  leaveMe: (q: { page?: number; pageSize?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.page) p.set('page', String(q.page));
    if (q.pageSize) p.set('pageSize', String(q.pageSize));
    const qs = p.toString();
    return `/leave/api/v1/leave/me${qs ? `?${qs}` : ''}`;
  },
  leaveBalanceMe: (year?: number) =>
    `/leave/api/v1/leave/me/balance${year ? `?year=${year}` : ''}`,
  submitLeave: '/leave/api/v1/leave/me',
  cancelLeave: (id: string) => `/leave/api/v1/leave/me/${id}/cancel`,
  leaveQueue: (q: { depotId?: string; status?: string } = {}) => {
    const p = new URLSearchParams();
    if (q.depotId) p.set('depotId', q.depotId);
    if (q.status) p.set('status', q.status);
    const qs = p.toString();
    return `/leave/api/v1/leave${qs ? `?${qs}` : ''}`;
  },
  leaveManagerDecision: (id: string) => `/leave/api/v1/leave/${id}/manager-decision`,
  leaveHrDecision: (id: string) => `/leave/api/v1/leave/${id}/hr-decision`,
  employeeDocuments: (employeeId: string) =>
    `/employee-documents/api/v1/employee-documents?employeeId=${encodeURIComponent(employeeId)}`,
  uploadEmployeeDocument: '/employee-documents/api/v1/employee-documents',
  /**
   * SEC-01: the document's bytes, behind the session. The list used to carry a permanent
   * unsigned storage URL and the screen linked straight to it — a KTP scan anybody who
   * had ever seen the link could open forever, signed out.
   */
  employeeDocumentFile: (id: string) =>
    `/employee-documents/api/v1/employee-documents/${encodeURIComponent(id)}/file`,
  assets: (
    q: {
      depotId?: string;
      status?: string;
      type?: string;
      holderId?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) => {
    const p = new URLSearchParams();
    if (q.depotId) p.set('depotId', q.depotId);
    if (q.status) p.set('status', q.status);
    if (q.type) p.set('type', q.type);
    if (q.holderId) p.set('holderId', q.holderId);
    if (q.page) p.set('page', String(q.page));
    if (q.pageSize) p.set('pageSize', String(q.pageSize));
    const qs = p.toString();
    return `/employee-assets/api/v1/employee-assets${qs ? `?${qs}` : ''}`;
  },
  asset: (id: string) => `/employee-assets/api/v1/employee-assets/${id}`,
  createAsset: '/employee-assets/api/v1/employee-assets',
  moveAsset: (id: string) => `/employee-assets/api/v1/employee-assets/${id}/movements`,
  announcements: (q: { page?: number; pageSize?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.page) p.set('page', String(q.page));
    if (q.pageSize) p.set('pageSize', String(q.pageSize));
    const qs = p.toString();
    return `/announcements/api/v1/announcements${qs ? `?${qs}` : ''}`;
  },
  announcement: (id: string) => `/announcements/api/v1/announcements/${id}`,
  createAnnouncement: '/announcements/api/v1/announcements',
  announcementsMe: '/announcements/api/v1/announcements/me',
  readAnnouncement: (id: string) => `/announcements/api/v1/announcements/me/${id}/read`,
  performanceDashboard: (periodMonth: string, depotId?: string) => {
    const p = new URLSearchParams({ periodMonth });
    if (depotId) p.set('depotId', depotId);
    return `/performance/api/v1/performance/dashboard?${p}`;
  },
  generatePerformance: '/performance/api/v1/performance/generate',
  // Score ONE employee for a period without saving anything. The manual review form used
  // to ask for a number with nothing to base it on; this is what the number is.
  performanceScore: (employeeId: string, periodMonth: string) =>
    `/performance/api/v1/performance/score?employeeId=${encodeURIComponent(employeeId)}&periodMonth=${encodeURIComponent(periodMonth)}`,
  shiftRotations: (depotId?: string) =>
    `/shift-rotations/api/v1/shift-rotations${depotId ? `?depotId=${encodeURIComponent(depotId)}` : ''}`,
  createShiftRotation: '/shift-rotations/api/v1/shift-rotations',
  updateShiftRotation: (id: string) => `/shift-rotations/api/v1/shift-rotations/${id}`,
  shiftAssignments: (employeeId: string) =>
    `/shift-rotations/api/v1/shift-rotations/assignments?employeeId=${encodeURIComponent(employeeId)}`,
  createShiftAssignment: '/shift-rotations/api/v1/shift-rotations/assignments',
  /** C4 reports. `kind` picks the route; all of them take csv | xlsx | pdf. */
  hrReport: (
    kind: 'late' | 'leave' | 'performance' | 'assets' | 'announcements',
    q: {
      from?: string;
      to?: string;
      periodMonth?: string;
      depotId?: string;
      format?: string;
    } = {},
  ) => {
    const p = new URLSearchParams();
    if (q.from) p.set('from', q.from);
    if (q.to) p.set('to', q.to);
    if (q.periodMonth) p.set('periodMonth', q.periodMonth);
    if (q.depotId) p.set('depotId', q.depotId);
    if (q.format) p.set('format', q.format);
    const qs = p.toString();
    return `/hr-reports/api/v1/hr-reports/${kind}${qs ? `?${qs}` : ''}`;
  },
  createShift: '/hr-shifts/api/v1/hr-shifts',
  updateShift: (id: string) => `/hr-shifts/api/v1/hr-shifts/${id}`,
  deleteShift: (id: string) => `/hr-shifts/api/v1/hr-shifts/${id}`,
},
} as const;
