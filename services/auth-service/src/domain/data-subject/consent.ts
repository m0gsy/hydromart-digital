/**
 * UU PDP tahap 2 — the consent ledger (item 13 follow-up).
 *
 * Tahap 1 could not offer "withdraw consent" because consent was a checkbox at signup
 * with no record of its own: there was nothing to revoke and nothing to prove. This is
 * that record — one row per purpose per decision, append-only, so the answer to "what
 * did this customer agree to, and when" is a query rather than an inference from
 * `createdAt`.
 */

export const CONSENT_PURPOSES = ['TERMS', 'PRIVACY', 'MARKETING'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/**
 * Purposes the service cannot run without. They are recorded at registration and cannot
 * be withdrawn while the account lives — withdrawing the legal basis for processing an
 * order you asked us to deliver is not a state the system can serve. Asking for that is
 * asking for deletion, and the customer is pointed at that instead.
 */
export const MANDATORY_PURPOSES: readonly ConsentPurpose[] = ['TERMS', 'PRIVACY'];

/** Optional purposes may be turned on and off at will, as often as the customer likes. */
export function isWithdrawable(purpose: ConsentPurpose): boolean {
  return !MANDATORY_PURPOSES.includes(purpose);
}

export interface ConsentRecord {
  id: string;
  customerId: string;
  purpose: ConsentPurpose;
  granted: boolean;
  /** Version of the text agreed to, so a later re-consent prompt can compare. */
  documentVersion: string;
  /** Where the decision came from — 'registration', 'account-settings', … */
  source: string;
  recordedAt: Date;
}

/**
 * The current answer per purpose: the newest row wins. Purposes with no row at all are
 * absent rather than defaulted to false — "never asked" and "said no" are different
 * facts, and a consent ledger that blurs them is worse than none.
 */
export function currentConsents(records: ConsentRecord[]): Map<ConsentPurpose, ConsentRecord> {
  const latest = new Map<ConsentPurpose, ConsentRecord>();
  for (const record of records) {
    const seen = latest.get(record.purpose);
    if (!seen || record.recordedAt.getTime() > seen.recordedAt.getTime()) {
      latest.set(record.purpose, record);
    }
  }
  return latest;
}

/** Whether a purpose is currently granted (absent = not granted, but never "refused"). */
export function hasConsent(records: ConsentRecord[], purpose: ConsentPurpose): boolean {
  return currentConsents(records).get(purpose)?.granted ?? false;
}

export function isConsentPurpose(value: unknown): value is ConsentPurpose {
  return CONSENT_PURPOSES.includes(value as ConsentPurpose);
}
