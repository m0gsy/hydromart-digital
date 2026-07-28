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
 * Reject a policy edit that would weaken a legal floor. Returns null when the change is
 * allowed, or a human-readable reason when it is not.
 */
export function rejectionReasonFor(dataClass: DataClass, windowDays: number): string | null {
  if (dataClass === DataClass.FINANCIAL && windowDays < FINANCIAL_MIN_WINDOW_DAYS) {
    return `Data keuangan wajib disimpan minimal ${FINANCIAL_MIN_WINDOW_DAYS} hari (10 tahun).`;
  }
  if (windowDays < 0) return 'Masa simpan tidak boleh negatif.';
  return null;
}
