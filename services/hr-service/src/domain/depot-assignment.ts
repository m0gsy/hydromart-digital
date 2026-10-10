// Rules for PLANNING a cross-depot assignment. Pure: the caller loads the employee and the
// open assignments (under a row lock) and hands them in, so the same function decides at
// planning time and in the tests.
//
// It returns every problem rather than the first, so the person fixing the form sees the
// whole list instead of discovering them one submit at a time.

import { HR_MANAGED_ROLES } from '@hydromart/access';

import { daysBetween } from './depot-on';

/** How far ahead an assignment may be planned. A typo'd year must not park someone for a decade. */
export const MAX_HORIZON_DAYS = 366;

export interface PlanInput {
  kind: 'LOAN' | 'PERMANENT';
  /** The depot they are sent TO. */
  depotId: string;
  startDate: string;
  /** Inclusive last day of a LOAN; null for PERMANENT. */
  endDate: string | null;
}

export interface PlanSubject {
  role: string | null;
  hasAccount: boolean;
  status: string;
  homeDepotId: string | null;
  joinDate: string;
  exitDate: string | null;
}

export interface OpenAssignment {
  id: string;
  kind: 'LOAN' | 'PERMANENT';
  startDate: string;
  endDate: string | null;
}

/** How far back a plan may start. Past a quarter the books are closed in every way that matters. */
export const MAX_BACKDATE_DAYS = 92;

/**
 * What has to be known about the past before a plan may start in it. Gathered by the caller
 * (it takes reads of other tables); this module only decides.
 */
export interface BackdateFacts {
  /** Only HR (and the superuser) may rewrite where somebody worked. */
  actorMayBackdate: boolean;
  /** `YYYY-MM` months in the window whose payslip is already APPROVED or PAID. */
  lockedMonths: readonly string[];
  /** Attendance days in the window already stamped with a depot other than the destination. */
  stampConflicts: number;
}

/** A permanent move never ends, so for overlap purposes it runs to the far future. */
const FOREVER = '9999-12-31';

export function planProblems(
  input: PlanInput,
  subject: PlanSubject,
  open: readonly OpenAssignment[],
  today: string,
  backdate?: BackdateFacts,
): string[] {
  const out: string[] = [];

  if (!subject.role || !(HR_MANAGED_ROLES as readonly string[]).includes(subject.role)) {
    out.push(
      'Jabatan karyawan ini tidak bisa ditugaskan lintas depot (hanya staf depot sampai manajer).',
    );
  }
  if (!subject.hasAccount) out.push('Karyawan ini belum punya akun login; buatkan akunnya dulu.');
  if (subject.status !== 'ACTIVE') out.push('Hanya karyawan aktif yang bisa ditugaskan.');
  if (!subject.homeDepotId) out.push('Karyawan ini belum punya depot asal.');
  else if (input.depotId === subject.homeDepotId) {
    out.push('Depot tujuan sama dengan depot asal karyawan.');
  }

  const end = input.endDate;
  if (input.kind === 'LOAN') {
    if (!end || end < input.startDate) {
      out.push('Tanggal akhir peminjaman wajib diisi dan tidak boleh sebelum tanggal mulai.');
    }
  } else if (end) {
    out.push('Mutasi permanen tidak punya tanggal akhir.');
  }

  if (input.startDate < today) {
    if (!backdate?.actorMayBackdate) {
      out.push(
        'Penugasan tidak bisa dimulai di masa lampau; atur tanggal mulai hari ini atau sesudahnya.',
      );
    } else {
      if (daysBetween(input.startDate, today) > MAX_BACKDATE_DAYS) {
        out.push(`Tanggal mulai terlalu lampau (maksimal ${MAX_BACKDATE_DAYS} hari ke belakang).`);
      }
      if (backdate.lockedMonths.length > 0) {
        out.push(
          `Payroll ${backdate.lockedMonths.join(', ')} sudah disetujui atau dibayar; ` +
            'koreksi pembagian depotnya lewat pusat, bukan dengan menggeser tanggal.',
        );
      }
      if (backdate.stampConflicts > 0) {
        out.push(
          `${backdate.stampConflicts} hari absensi pada rentang itu tercatat di depot lain; ` +
            'koreksi stempel absensinya dulu.',
        );
      }
    }
  } else if (daysBetween(today, input.startDate) > MAX_HORIZON_DAYS) {
    out.push(`Tanggal mulai terlalu jauh (maksimal ${MAX_HORIZON_DAYS} hari ke depan).`);
  }

  if (input.startDate < subject.joinDate) {
    out.push('Tanggal mulai sebelum karyawan masuk kerja.');
  }
  if (
    subject.exitDate &&
    (input.startDate > subject.exitDate || (end ?? input.startDate) > subject.exitDate)
  ) {
    out.push('Penugasan melewati tanggal keluar karyawan.');
  }

  const last = end ?? FOREVER;
  for (const other of open) {
    const otherLast = other.endDate ?? FOREVER;
    if (input.startDate <= otherLast && other.startDate <= last) {
      out.push('Penugasan bertabrakan dengan penugasan lain yang masih berjalan atau terjadwal.');
      break;
    }
  }
  return out;
}
