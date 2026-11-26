import { DueCompliance } from '../application/ports/compliance-due.port';
import { ITEMS_PER_DIGEST } from './maintenance-due';
import { NotificationEvent } from './notification-event';

/** Dedupe-key families: the same shape as maintenance-due's, one family per kind (see maintenance-due.ts). */
export const COMPLIANCE_KINDS = [
  { kind: 'PERMIT', event: NotificationEvent.PERMIT_DUE, prefix: 'permit-due' },
  { kind: 'LAB_TEST', event: NotificationEvent.LAB_TEST_DUE, prefix: 'lab-test-due' },
] as const;

export { ITEMS_PER_DIGEST };
const LISTED_ITEMS = 5;

/** The words for one item: the day it fell due and how far past (or before) that is. */
export function complianceReason(item: DueCompliance): string {
  if (item.kind === 'PERMIT') {
    if (item.daysLeft > 0) return `berlaku sampai ${item.dueOn}, ${item.daysLeft} hari lagi`;
    return item.daysLeft === 0 ? 'berlaku sampai hari ini' : `sudah habis ${-item.daysLeft} hari`;
  }
  return item.daysLeft === 0 ? `batas uji ${item.dueOn}, hari ini` : `batas uji ${item.dueOn}, terlambat ${-item.daysLeft} hari`;
}

/** One depot's digest: its name, and its due items with the reason each is due. */
export function complianceDigest(items: readonly DueCompliance[]): { depot: string; items: string; depotId: string } {
  const listed = items.slice(0, LISTED_ITEMS).map((i) => `${i.name} (${complianceReason(i)})`);
  const rest = items.length - listed.length;
  return {
    depot: items[0].depotName,
    depotId: items[0].depotId,
    items: rest > 0 ? `${listed.join('; ')}; dan ${rest} lainnya` : listed.join('; '),
  };
}
