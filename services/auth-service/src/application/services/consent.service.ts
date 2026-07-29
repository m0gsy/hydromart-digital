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

/** Current text version. Bump when the wording materially changes. */
export const CONSENT_DOCUMENT_VERSION = '1.0';

export interface ConsentStateEntry {
  purpose: ConsentPurpose;
  granted: boolean;
  mandatory: boolean;
  withdrawable: boolean;
  /** Null when this purpose has never been put to the customer. */
  decidedAt: Date | null;
  documentVersion: string | null;
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
      };
    });
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
