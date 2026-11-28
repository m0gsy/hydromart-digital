/**
 * HD-12: what a month of WhatsApp may cost, as pure functions. The counter is per message and per category
 * and counts what we hand to Meta (an upper bound, released when Meta refuses a message or says it was not
 * billable). Nothing here knows a price: the rate comes from the HQ-entered cap row, and with no rate the cost
 * is "belum diisi", never a guess.
 */
export const WA_CATEGORIES = ['UTILITY', 'MARKETING', 'AUTHENTICATION', 'SERVICE'] as const;
export type WaCategory = (typeof WA_CATEGORIES)[number];

/** A cap row as HQ entered it. No row at all = nothing may be sent (fail closed). */
export interface WaCapLimits {
  monthlyMessages: number;
  rateIdr: number | null;
  monthlyCostIdr: number | null;
  paused: boolean;
}

/** Warn at 80% of the monthly message cap (rounded up), once. */
export function warnThreshold(monthlyMessages: number): number {
  return Math.ceil(0.8 * monthlyMessages);
}

/** Customer-service replies cost nothing to us and are counted at rate 0; the rest at the HQ rate. */
export function rateFor(category: WaCategory, cap: Pick<WaCapLimits, 'rateIdr'>): number | null {
  return category === 'SERVICE' ? 0 : cap.rateIdr;
}

/** Cost shown to HQ: null ("belum diisi") until a rate is entered. */
export function estimatedCostIdr(messages: number, rateIdr: number | null): number | null {
  return rateIdr === null ? null : Math.round(messages * rateIdr * 100) / 100;
}

/**
 * Can one more message be reserved, given what is already counted? The same two rules the repository applies
 * in its single conditional UPDATE: the count stays within the cap, and the cost stays within the cost cap,
 * which is enforced only when a rate is set.
 */
export function reservation(
  cap: WaCapLimits | null,
  counted: { messages: number; costIdr: number },
  rateIdr: number | null,
):
  | { ok: true; messages: number; costIdr: number; warn: boolean; reachesCap: boolean }
  | { ok: false; reason: 'CAP' | 'PAUSED' } {
  if (!cap) return { ok: false, reason: 'CAP' };
  if (cap.paused) return { ok: false, reason: 'PAUSED' };
  const messages = counted.messages + 1;
  const costIdr = Math.round((counted.costIdr + (rateIdr ?? 0)) * 100) / 100;
  if (messages > cap.monthlyMessages) return { ok: false, reason: 'CAP' };
  if (rateIdr !== null && cap.monthlyCostIdr !== null && costIdr > cap.monthlyCostIdr) {
    return { ok: false, reason: 'CAP' };
  }
  return {
    ok: true,
    messages,
    costIdr,
    warn: messages >= warnThreshold(cap.monthlyMessages),
    reachesCap: messages === cap.monthlyMessages,
  };
}
