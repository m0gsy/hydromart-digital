import { Inject, Injectable, Logger } from '@nestjs/common';

import { maskAccount } from '../../domain/bank-account';
import { BankAccountNotPendingError, PayoutDestinationNotVerifiedError } from '../../domain/errors';
import {
  BankAccountStatus,
  PayoutBankAccountRecord,
  PayoutBankAccountRepository,
  PayoutSubjectType,
  RegisterBankAccountData,
} from '../ports/bank-account.repository';
import { PAYOUT_TOKENS } from '../tokens';

/**
 * PYO-3, owner decision 2026-09-17 — the payout destination on file.
 *
 * A withdrawal used to carry a bank account typed into the request, unverified, and an HQ
 * release reused whatever the last one happened to say. One account per person now,
 * registered once and verified by head office; a replacement goes back for checking, and
 * money only ever leaves to a VERIFIED row.
 */
@Injectable()
export class PayoutBankAccountService {
  private readonly logger = new Logger(PayoutBankAccountService.name);

  constructor(
    @Inject(PAYOUT_TOKENS.BankAccountRepository)
    private readonly accounts: PayoutBankAccountRepository,
  ) {}

  register(
    subjectId: string,
    subjectType: PayoutSubjectType,
    data: Omit<RegisterBankAccountData, 'subjectId' | 'subjectType'>,
  ): Promise<PayoutBankAccountRecord> {
    return this.accounts.upsert({
      subjectId,
      subjectType,
      bankName: data.bankName.trim(),
      accountNumber: data.accountNumber.replace(/\s+/g, ''),
      accountHolder: data.accountHolder.trim(),
    });
  }

  mine(subjectId: string): Promise<PayoutBankAccountRecord | null> {
    return this.accounts.findBySubject(subjectId);
  }

  listByStatus(status: BankAccountStatus, limit = 100): Promise<PayoutBankAccountRecord[]> {
    return this.accounts.listByStatus(status, limit);
  }

  async decide(
    id: string,
    verifiedBy: string,
    verified: boolean,
    reason: string | null,
  ): Promise<PayoutBankAccountRecord> {
    const decided = await this.accounts.decide(id, {
      status: verified ? 'VERIFIED' : 'REJECTED',
      verifiedBy,
      rejectedReason: verified ? null : (reason?.trim() || null),
    });
    if (!decided) throw new BankAccountNotPendingError();
    this.logger.log(`payout.bank_account.${verified ? 'verified' : 'rejected'} id=${id} by=${verifiedBy}`);
    return decided;
  }

  /**
   * The masked destination a withdrawal records, from the VERIFIED account on file.
   *
   * Refuses when there is none: a debit whose destination nobody has checked is exactly what
   * this table exists to stop, and a refusal is recoverable where a wrong transfer is not.
   */
  async verifiedDestination(subjectId: string): Promise<string> {
    const account = await this.accounts.findBySubject(subjectId);
    if (!account || account.status !== 'VERIFIED') throw new PayoutDestinationNotVerifiedError();
    return maskAccount(account.bankName, account.accountNumber);
  }
}
