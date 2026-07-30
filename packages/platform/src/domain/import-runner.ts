/**
 * Shared runner for the CSV bulk-import endpoints (employees, inventory, prices,
 * customers, resellers). Every import has the same contract, so it lives once:
 *
 * - rows are processed one by one, in order, and a failure stops only that row;
 * - the result is a per-row verdict the wizard can show and re-download.
 *
 * There is deliberately no cross-row transaction: several of these imports write
 * across two services, and an admin action that can simply be re-run doesn't earn a
 * saga. Each handler is expected to be idempotent enough that a re-upload reports
 * `skipped` rather than duplicating.
 */

export type ImportRowStatus = 'created' | 'updated' | 'skipped' | 'failed';

export interface ImportRowResult {
  /** 1-based position within the submitted batch (what the UI echoes back). */
  row: number;
  status: ImportRowStatus;
  message?: string;
  id?: string;
}

export interface ImportSummary {
  created: number;
  /** Rows that matched an existing record and overwrote it (upsert mode only). */
  updated: number;
  skipped: number;
  failed: number;
  results: ImportRowResult[];
}

/** What a handler returns; throwing instead marks the row `failed` with the message. */
export type ImportRowOutcome = { status: ImportRowStatus; id?: string; message?: string };

export async function runImport<T>(
  rows: readonly T[],
  handle: (row: T, index: number) => Promise<ImportRowOutcome>,
  /** Classifies a thrown error as a duplicate (`skipped`) rather than a failure. */
  isDuplicate: (err: unknown) => boolean = () => false,
): Promise<ImportSummary> {
  const results: ImportRowResult[] = [];

  for (const [index, item] of rows.entries()) {
    const row = index + 1;
    try {
      results.push({ row, ...(await handle(item, index)) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal memproses baris';
      results.push({ row, status: isDuplicate(err) ? 'skipped' : 'failed', message });
    }
  }

  return {
    created: results.filter((r) => r.status === 'created').length,
    updated: results.filter((r) => r.status === 'updated').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  };
}
