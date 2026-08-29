import { ConsentPurpose, ConsentRecord } from '../../domain/data-subject/consent';

export interface RecordConsentData {
  customerId: string;
  purpose: ConsentPurpose;
  granted: boolean;
  documentVersion: string;
  source: string;
}

export interface ConsentRepository {
  /** Append one decision. Never updates a prior row — the history IS the evidence. */
  record(data: RecordConsentData): Promise<ConsentRecord>;
  /** Append several in one transaction (registration grants TERMS + PRIVACY together). */
  recordMany(entries: RecordConsentData[]): Promise<ConsentRecord[]>;
  /** Every decision this customer has made, oldest first. */
  listForCustomer(customerId: string): Promise<ConsentRecord[]>;
}

/** One page of the fleet report, plus the ceiling and cursor that bound it. */
export interface ConsentLagQuery {
  /** The document version in force. Anything else on a granted row is behind it. */
  version: string;
  /** Which purposes count as owed. Only the mandatory ones ever should — see the service. */
  purposes: readonly ConsentPurpose[];
  /** Hard page ceiling. The caller clamps it; the query obeys it. */
  limit: number;
  /** Keyset cursor: the previous page's last customer id. Ordered by id, so it is stable. */
  cursor?: string;
}

/**
 * Fleet counts at CUSTOMER grain.
 *
 * Only `current` is exclusive. The other three OVERLAP by construction and must: one
 * account can have been asked about TERMS under retired wording and never asked about
 * PRIVACY at all, and collapsing that into a single winning label would destroy the one
 * distinction this whole report exists to keep — a gap is not a refusal. Summing them and
 * expecting `population` is therefore wrong.
 */
export interface ConsentLagTotals {
  /** Accounts in scope: role CUSTOMER, not DELETED. */
  population: number;
  /** Nothing owed: every mandatory purpose granted at the version in force. */
  current: number;
  /** At least one mandatory purpose with no row at all. */
  neverAsked: number;
  /** At least one mandatory purpose whose newest row says no. */
  refused: number;
  /** At least one mandatory purpose granted against retired wording. */
  outdated: number;
}

/** One account that owes something, and exactly what it owes on each count. */
export interface ConsentLagCustomer {
  /** Named `id` so `nextCursor()` from @hydromart/platform can key the page off it. */
  id: string;
  neverAsked: ConsentPurpose[];
  refused: ConsentPurpose[];
  outdated: ConsentPurpose[];
}

export interface ConsentLagPage {
  totals: ConsentLagTotals;
  /** Only accounts that owe something. An empty page with a full total means the end. */
  items: ConsentLagCustomer[];
  nextCursor: string | null;
}

/**
 * The fleet-wide half of the ledger (W10), deliberately a SEPARATE port from
 * `ConsentRepository`.
 *
 * `ConsentRepository` answers about one customer, always the caller's own. This one scans
 * every account there is, so it is a different power and asking for it is a different act:
 * a caller holding the per-customer port cannot reach the fleet by accident. The Prisma
 * class implements both, and both resolve from the same DI token.
 */
export interface ConsentLagReader {
  mandatoryLag(query: ConsentLagQuery): Promise<ConsentLagPage>;
}
