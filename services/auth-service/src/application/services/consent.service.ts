import { Inject, Injectable } from '@nestjs/common';

import { ConsentNotWithdrawableError } from '../../domain/errors/auth.errors';
import {
  CONSENT_PURPOSES,
  ConsentPurpose,
  ConsentRecord,
  MANDATORY_PURPOSES,
  currentConsents,
  isWithdrawable,
} from '../../domain/data-subject/consent';
import { ConsentRepository } from '../ports/consent.repository';
import { AUTH_TOKENS } from '../tokens';

/**
 * Version of the Terms + Privacy text a consent row was recorded against.
 *
 * A date rather than a counter, because it is checkable: both documents carry the same
 * `Berlaku sejak` line in apps/web/src/lib/dictionaries/{id,en}/{terms,privacy}.ts, so a
 * support agent can line a stored version up against the document a customer is reading.
 * Bump this AND that `effective` line together whenever the wording changes materially.
 *
 * It read '1.0' from 2026-07-29 — the ledger migration, which also backfilled every
 * existing customer at that value — until 2026-08-29, when the Terms of Service were
 * written for the first time. So every production row still names a version whose Terms
 * document did not exist on the day it was agreed to, and `pendingAcceptance` below is
 * what makes that fact answerable instead of merely stored.
 */
export const CONSENT_DOCUMENT_VERSION = '2026-08-29';

export interface ConsentStateEntry {
  purpose: ConsentPurpose;
  granted: boolean;
  mandatory: boolean;
  withdrawable: boolean;
  /** Null when this purpose has never been put to the customer. */
  decidedAt: Date | null;
  documentVersion: string | null;
  /**
   * Recorded against older wording than the version in force. Purely a fact about the
   * row: no row at all is `false`, because "never asked" has no document to be behind.
   * Whether being outdated should prompt anything is policy, and lives in
   * `pendingAcceptance` — not here.
   */
  outdated: boolean;
}

/**
 * UU PDP tahap 2. Consent is now a ledger rather than an inference from `createdAt`,
 * which is what made "withdraw" impossible in tahap 1.
 *
 * Withdrawal is offered only for optional purposes. Withdrawing TERMS/PRIVACY would
 * leave a live account with no lawful basis to process the orders it keeps placing —
 * a state nothing downstream can honour. That request is deletion, and the error says so
 * rather than silently doing nothing.
 */
@Injectable()
export class ConsentService {
  constructor(
    @Inject(AUTH_TOKENS.ConsentRepository) private readonly consents: ConsentRepository,
  ) {}

  /** Registration: the signup checkbox becomes real rows instead of a remembered click. */
  async recordRegistrationConsent(customerId: string, marketing = false): Promise<void> {
    const entries = MANDATORY_PURPOSES.map((purpose) => ({
      customerId,
      purpose,
      granted: true,
      documentVersion: CONSENT_DOCUMENT_VERSION,
      source: 'registration',
    }));
    // Only record MARKETING when it was actually offered and ticked. Writing `false`
    // for an unasked question would turn "never asked" into "refused".
    if (marketing) {
      entries.push({
        customerId,
        purpose: 'MARKETING' as ConsentPurpose,
        granted: true,
        documentVersion: CONSENT_DOCUMENT_VERSION,
        source: 'registration',
      });
    }
    await this.consents.recordMany(entries);
  }

  /** Every purpose with its current answer — including ones never asked. */
  async stateFor(customerId: string): Promise<ConsentStateEntry[]> {
    const latest = currentConsents(await this.consents.listForCustomer(customerId));
    return CONSENT_PURPOSES.map((purpose) => {
      const record = latest.get(purpose);
      return {
        purpose,
        granted: record?.granted ?? false,
        mandatory: !isWithdrawable(purpose),
        withdrawable: isWithdrawable(purpose),
        decidedAt: record?.recordedAt ?? null,
        documentVersion: record?.documentVersion ?? null,
        outdated: record ? record.documentVersion !== CONSENT_DOCUMENT_VERSION : false,
      };
    });
  }

  /**
   * The mandatory purposes this customer still has to accept at the version in force:
   * agreed against older wording, or never recorded at all (accounts that predate the
   * ledger, and anyone the '1.0' backfill missed).
   *
   * Read-only ON PURPOSE, and this is the whole design. Bumping the version must never
   * revoke anything retroactively: the earlier acceptance stays granted, no order in
   * flight loses its lawful basis, and nobody is shut out of their account over wording
   * they were never shown. Appearing here means "still to be asked" — the same
   * "never asked != refused" rule the ledger already keeps, applied to a second document.
   * Only the customer can turn that into a refusal.
   *
   * MARKETING is deliberately never on this list even when its row is outdated: a fresh
   * opt-in prompt that the customer ignores would quietly read as a withdrawal of an
   * opt-in they already gave.
   */
  async pendingAcceptance(customerId: string): Promise<ConsentPurpose[]> {
    const state = await this.stateFor(customerId);
    return state
      .filter((entry) => entry.mandatory && (!entry.granted || entry.outdated))
      .map((entry) => entry.purpose);
  }

  /**
   * Grant or withdraw one optional purpose. Idempotent by nature: setting the same value
   * twice appends a second row, which is correct — the ledger records decisions, not
   * state, and "confirmed again on this date" is a real fact.
   */
  async set(
    customerId: string,
    purpose: ConsentPurpose,
    granted: boolean,
    source = 'account-settings',
  ): Promise<ConsentRecord> {
    if (!granted && !isWithdrawable(purpose)) {
      throw new ConsentNotWithdrawableError(purpose);
    }
    return this.consents.record({
      customerId,
      purpose,
      granted,
      documentVersion: CONSENT_DOCUMENT_VERSION,
      source,
    });
  }

  /** Full history, for the customer's own view and for proving what happened when. */
  history(customerId: string): Promise<ConsentRecord[]> {
    return this.consents.listForCustomer(customerId);
  }
}
