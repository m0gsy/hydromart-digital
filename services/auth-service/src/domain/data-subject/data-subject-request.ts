/**
 * UU PDP tahap 1 — data-subject requests (item 13).
 *
 * Two rights ship first: EXPORT (give the customer a copy of what we hold) and DELETE
 * (stop holding their identity). Consent withdrawal is deliberately NOT here: consent
 * today is the signup checkbox with no record of its own, so "withdraw" would have
 * nothing to revoke. It needs a consent ledger first.
 *
 * Neither right executes on the customer's click. A request enters a queue that HEAD
 * OFFICE works through, because both are irreversible from the customer's side and an
 * account can be taken over — an automatic delete button is a takeover's best weapon.
 */

export const DATA_SUBJECT_REQUEST_TYPES = ['EXPORT', 'DELETE'] as const;
export type DataSubjectRequestType = (typeof DATA_SUBJECT_REQUEST_TYPES)[number];

export const DATA_SUBJECT_REQUEST_STATUSES = ['PENDING', 'COMPLETED', 'REJECTED'] as const;
export type DataSubjectRequestStatus = (typeof DATA_SUBJECT_REQUEST_STATUSES)[number];

export interface DataSubjectRequestRecord {
  id: string;
  customerId: string;
  type: DataSubjectRequestType;
  status: DataSubjectRequestStatus;
  /** Why the customer asked (DELETE) or why staff refused (REJECTED). Free text. */
  reason: string | null;
  requestedAt: Date;
  processedBy: string | null;
  processedAt: Date | null;
}

/**
 * A DELETE cannot remove everything. Records under the FINANCIAL retention class must
 * survive a tax audit for ten years (item 12), so deletion anonymises instead: every
 * identifier is destroyed, the money rows keep their amounts and lose their owner.
 *
 * This is the list of fields the anonymisation must clear. It lives in the domain so a
 * new PII column is a compile-time decision rather than something a reviewer has to
 * notice.
 */
export interface AnonymisedIdentity {
  /** Unique columns cannot simply be blanked — they get a per-account tombstone value. */
  phone: string;
  email: null;
  fullName: string;
  avatarUrl: null;
  googleSub: null;
}

/** Tombstone that keeps the UNIQUE constraint satisfiable without carrying a number. */
export function anonymisedIdentity(customerId: string): AnonymisedIdentity {
  return {
    phone: `deleted-${customerId}`,
    email: null,
    fullName: 'Pengguna dihapus',
    avatarUrl: null,
    googleSub: null,
  };
}

/** Only a PENDING request can be decided; deciding twice would re-run the side effect. */
export function isDecidable(record: DataSubjectRequestRecord): boolean {
  return record.status === 'PENDING';
}
