import { ApiError } from '@/lib/api';

/** The server's refusal text IS the guidance (Indonesian, already user-facing); only a stale write is ours to word. */
export const STALE_CODE = 'CUSTOMER_PROSPECT_STALE';

export function saveError(e: unknown, t: (key: string) => string): { stale: boolean; message: string } {
  if (e instanceof ApiError) {
    if (e.status === 409 && e.code === STALE_CODE) return { stale: true, message: t('opsFix.prospects.actions.stale') };
    if (e.message) return { stale: false, message: e.message };
  }
  return { stale: false, message: t('opsFix.prospects.actions.failed') };
}
