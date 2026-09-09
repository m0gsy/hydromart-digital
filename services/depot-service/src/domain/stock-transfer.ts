/**
 * CA-2-54 — where a stock transfer is between leaving one depot and arriving at another.
 *
 * Two steps rather than one, because a transfer is not instantaneous: the goods spend real
 * time on a motorbike. SENT deducts the sender immediately — they no longer have it — and
 * RECEIVED credits the receiver only once somebody there has counted it. What sits between
 * the two is visible as exactly that, instead of being absent from both books at once.
 */
export enum StockTransferStatus {
  SENT = 'SENT',
  RECEIVED = 'RECEIVED',
  CANCELLED = 'CANCELLED',
}

/** `TRF-260909-0001` — the day, then the day's sequence. Readable over a phone. */
export function transferReference(day: string, sequence: number): string {
  return `TRF-${day.replace(/-/g, '').slice(2)}-${String(sequence).padStart(4, '0')}`;
}
