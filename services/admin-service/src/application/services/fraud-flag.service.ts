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
   * Clearing a flag lifts the suspension it caused — if nothing else is holding it.
   *
   * A queue that can block an account and cannot unblock it makes every false positive
   * permanent, and the operator who cleared it would have no way to tell the customer is
   * still locked out. ADM-8 found the two ways the original rule got that wrong.
   *
   * It reinstated whenever THIS flag read BLOCKED, so an account held by two separate
   * suspicions was released by resolving either one: the other flag stayed BLOCKED on the
   * screen while the customer ordered again. And it reinstated ONLY when this flag read
   * BLOCKED, so the ordinary path — block, mark reviewed, then clear — never lifted the
   * suspension at all, because by then the flag said REVIEWED. The account stayed locked
   * out with every flag against it resolved, and nothing in the queue showed why.
   *
   * The question is therefore not "was this flag blocked" but "is this account still held":
   * reinstate exactly when no OTHER flag on the same entity is BLOCKED.
   */
  async clear(id: string): Promise<FraudFlagRecord> {
    const flag = await this.repo.findById(id);
    if (!flag) throw new FraudFlagNotFoundError(id);
    /*
     * Reinstate only when BOTH are true: this flag is the one that suspended the account,
     * and nothing else is still holding it.
     *
     * `blockedAt` answers the first — the flag's CURRENT status cannot, because the
     * ordinary path marks it REVIEWED on the way to CLEARED, and reading the status there
     * is why block → review → clear never released anybody. `countBlockedFor` answers the
     * second, which is why resolving one of two suspicions no longer opens the door.
     *
     * A flag that never blocked anything reinstates nothing: an account suspended for some
     * other reason entirely must not be reopened by tidying this queue.
     */
    if (flag.entityType === FraudEntityType.ACCOUNT && flag.blockedAt) {
      const heldElsewhere = await this.repo.countBlockedFor(flag.entityRef, id);
      if (heldElsewhere === 0) {
        await this.accounts.setActive(flag.entityRef, true);
      }
    }
    return this.transition(id, FraudStatus.CLEARED);
  }

  private async transition(id: string, status: FraudStatus): Promise<FraudFlagRecord> {
    const updated = await this.repo.setStatus(id, status);
    if (!updated) throw new FraudFlagNotFoundError(id);
    return updated;
  }
}
