// Data-retention classes (M23-21). Pure and framework-free: whether a record may be
// deleted is a compliance decision, so it lives in one tested place rather than being
// re-derived by whatever purge job runs next.

/**
 * What KIND of data a dataset holds. The class — not the window — decides whether a
 * purge may touch it at all.
 */
export enum DataClass {
  /** Orders, payments, invoices, ledgers. Kept 10 years and NEVER purged. */
  FINANCIAL = 'FINANCIAL',
  /** Deliveries, stock movements, proofs. Purged on its own window. */
  OPERATIONAL = 'OPERATIONAL',
  /** Employee, attendance and payroll records. Purged on its own window. */
  HR = 'HR',
  /** Campaign, notification and broadcast history. Shortest window. */
  MARKETING = 'MARKETING',
}

/** 10 years, the floor a FINANCIAL policy may never go below (M23-21). */
export const FINANCIAL_MIN_WINDOW_DAYS = 3650;

export function isDataClass(value: unknown): value is DataClass {
  return (
    value === DataClass.FINANCIAL ||
    value === DataClass.OPERATIONAL ||
    value === DataClass.HR ||
    value === DataClass.MARKETING
  );
}

/**
 * Financial data is exempt from purging outright — a tax audit years later must still
 * find the transaction, so "expired" never means "delete" for this class.
 */
export function isPurgeExempt(dataClass: DataClass): boolean {
  return dataClass === DataClass.FINANCIAL;
}

/**
 * The oldest timestamp a purge may keep. Records STRICTLY older than this are eligible.
 * Null means nothing is eligible — either the class is exempt or the window is
 * non-positive (which is treated as "keep everything", never as "delete everything").
 */
export function purgeCutoff(dataClass: DataClass, windowDays: number, now: Date): Date | null {
  if (isPurgeExempt(dataClass)) return null;
  if (!(windowDays > 0)) return null;
  return new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
}

/** Whether one record, stamped `createdAt`, may be deleted under this policy. */
export function isPurgeable(
  dataClass: DataClass,
  windowDays: number,
  createdAt: Date,
  now: Date,
): boolean {
  const cutoff = purgeCutoff(dataClass, windowDays, now);
  return cutoff !== null && createdAt.getTime() < cutoff.getTime();
}

/**
 * ADM-2: the shortest an audit trail may be kept, whatever its class says.
 *
 * A security trail answers "who did this, and when" for an investigation that starts after
 * somebody notices — which is months, not days. A window shorter than this does not make
 * the company lighter, it makes the next incident unreconstructable.
 */
export const AUDIT_MIN_WINDOW_DAYS = 365;

/** Datasets that ARE the audit trail, by the dataset name the policy row carries. */
function isAuditDataset(dataset: string | undefined): boolean {
  return dataset !== undefined && /audit|export_log/i.test(dataset);
}

/**
 * Reject a policy edit that would weaken a legal floor. Returns null when the change is
 * allowed, or a human-readable reason when it is not.
 *
 * ADM-2 — `currentClass` is what makes the FINANCIAL floor real. The floor was checked
 * against the class the CALLER supplied, so the same request that shortened the window
 * could reclassify the dataset out of FINANCIAL on its way past: one PUT, ten years of
 * order history eligible for deletion, and every check in this file passed. A class is a
 * statement about what the data IS, so it may be raised INTO FINANCIAL and never out of it.
 */
export function rejectionReasonFor(
  dataClass: DataClass,
  windowDays: number,
  currentClass?: DataClass,
  dataset?: string,
): string | null {
  if (currentClass === DataClass.FINANCIAL && dataClass !== DataClass.FINANCIAL) {
    return 'Kelas data keuangan tidak bisa diturunkan — masa simpan 10 tahunnya melekat pada datanya, bukan pada labelnya.';
  }
  if (dataClass === DataClass.FINANCIAL && windowDays < FINANCIAL_MIN_WINDOW_DAYS) {
    return `Data keuangan wajib disimpan minimal ${FINANCIAL_MIN_WINDOW_DAYS} hari (10 tahun).`;
  }
  if (isAuditDataset(dataset) && windowDays > 0 && windowDays < AUDIT_MIN_WINDOW_DAYS) {
    return `Jejak audit wajib disimpan minimal ${AUDIT_MIN_WINDOW_DAYS} hari — investigasi selalu dimulai setelah ada yang menyadari.`;
  }
  if (windowDays < 0) return 'Masa simpan tidak boleh negatif.';
  return null;
}
