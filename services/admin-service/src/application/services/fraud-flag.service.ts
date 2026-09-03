import { Inject, Injectable } from '@nestjs/common';

import { FraudStatus } from '../../domain/fraud';
import { FraudFlagNotFoundError } from '../../domain/errors';
import {
  CreateFraudFlagData,
  FraudFlagRecord,
  FraudFlagRepository,
  ListFraudFlagsFilter,
} from '../ports/fraud-flag.repository';
import { AccountSuspensionPort } from '../ports/account-suspension.port';
import { FraudEntityType } from '../../domain/fraud';
import { ADMIN_TOKENS } from '../tokens';

@Injectable()
export class FraudFlagService {
  constructor(
    @Inject(ADMIN_TOKENS.FraudFlagRepository) private readonly repo: FraudFlagRepository,
    @Inject(ADMIN_TOKENS.AccountSuspension) private readonly accounts: AccountSuspensionPort,
  ) {}

  /** Fraud flags (Design 15b), highest-score-then-newest first, optionally filtered. */
  list(filter: ListFraudFlagsFilter): Promise<FraudFlagRecord[]> {
    return this.repo.list(filter);
  }

  /** Record a flag (internal-key ingest). The score/level/signals are stored verbatim. */
  ingest(data: CreateFraudFlagData): Promise<FraudFlagRecord> {
    return this.repo.create(data);
  }

  /** Mark a flag REVIEWED. 404 when unknown. */
  review(id: string): Promise<FraudFlagRecord> {
    return this.transition(id, FraudStatus.REVIEWED);
  }

  /**
   * CA-2-05: block the ACCOUNT, then record that it happened.
   *
   * This used to set the flag's own status and nothing else, so "Blokir" turned a row red
   * and left the customer ordering. The suspension goes FIRST and its failure propagates:
   * a flag that reads BLOCKED while the account still signs in is the bug, so an
   * unreachable auth-service leaves the flag OPEN and the operator gets an error rather
   * than a false confirmation.
   *
   * An ORDER flag has no account to suspend — `entityRef` is an order id. Blocking one is
   * still a real decision (it is what the review queue records), it just cannot reach into
   * order-service from here; that is a separate wire and is not pretended at.
   */
  async block(id: string): Promise<FraudFlagRecord> {
    const flag = await this.repo.findById(id);
    if (!flag) throw new FraudFlagNotFoundError(id);
    if (flag.entityType === FraudEntityType.ACCOUNT) {
      await this.accounts.setActive(flag.entityRef, false);
    }
    return this.transition(id, FraudStatus.BLOCKED);
  }

  /**
   * Clearing a flag lifts the suspension it caused.
   *
   * Same reasoning in reverse: a queue that can block an account and cannot unblock it
   * makes every false positive permanent, and the operator who cleared it would have no
   * way to tell that the customer is still locked out.
   */
  async clear(id: string): Promise<FraudFlagRecord> {
    const flag = await this.repo.findById(id);
    if (!flag) throw new FraudFlagNotFoundError(id);
    if (flag.entityType === FraudEntityType.ACCOUNT && flag.status === FraudStatus.BLOCKED) {
      await this.accounts.setActive(flag.entityRef, true);
    }
    return this.transition(id, FraudStatus.CLEARED);
  }

  private async transition(id: string, status: FraudStatus): Promise<FraudFlagRecord> {
    const updated = await this.repo.setStatus(id, status);
    if (!updated) throw new FraudFlagNotFoundError(id);
    return updated;
  }
}
