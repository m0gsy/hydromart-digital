import { Inject, Injectable, Logger } from '@nestjs/common';
import { localDayKey } from '@hydromart/platform';

import { CustomerConfigService } from '../../config/customer-config.service';
import { LoyaltyRewardPort } from '../ports/loyalty-reward.port';
import {
  CustomerProfileRecord,
  DirectoryRecipient,
  ProfileRepository,
  SegmentFilter,
} from '../ports/profile.repository';
import { CustomerDepotDepositRow, DepotLedgerPort } from '../ports/depot-ledger.port';
import { CUSTOMER_TOKENS } from '../tokens';

export interface BirthdayRewardResult {
  /** Sweep reference date (ISO yyyy-mm-dd). */
  date: string;
  candidates: number;
  granted: number;
  failed: number;
  /** True when LOYALTY_SERVICE_URL is unset — nothing was granted or stamped. */
  disabled: boolean;
}

/** Customer profile extension: membership/points (read-only here) + favorite depot + DOB. */
@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    @Inject(CUSTOMER_TOKENS.ProfileRepository) private readonly profiles: ProfileRepository,
    @Inject(CUSTOMER_TOKENS.LoyaltyRewardPort) private readonly loyalty: LoyaltyRewardPort,
    @Inject(CUSTOMER_TOKENS.DepotLedgerPort) private readonly depotLedger: DepotLedgerPort,
    private readonly config: CustomerConfigService,
  ) {}

  /**
   * I5: the gallons this customer is still holding, and the deposit still with each depot.
   *
   * Both numbers already existed and were rendered only in the staff console, so the person
   * whose money it is had no screen for either. `null` means depot-service could not be
   * read — the screen has to say so rather than print zeroes, because a zero here reads as
   * "you have no deposit anywhere" and that is somebody's money.
   */
  myGallonDeposits(customerId: string): Promise<CustomerDepotDepositRow[] | null> {
    return this.depotLedger.depositsForCustomer(customerId);
  }

  /** Get the profile, lazily creating a default one on first access. */
  async get(customerId: string): Promise<CustomerProfileRecord> {
    const existing = await this.profiles.findByCustomerId(customerId);
    return existing ?? (await this.profiles.create(customerId));
  }

  async setFavoriteDepot(
    customerId: string,
    favoriteDepotId: string | null,
  ): Promise<CustomerProfileRecord> {
    await this.get(customerId); // ensure a row exists
    return this.profiles.updateFavoriteDepot(customerId, favoriteDepotId);
  }

  async setBirthdate(customerId: string, birthdate: Date | null): Promise<CustomerProfileRecord> {
    await this.get(customerId); // ensure a row exists
    return this.profiles.updateBirthdate(customerId, birthdate);
  }

  /** Staff: resolve the CRM broadcast audience for an attribute segment (FR-087). */
  findSegment(filter: SegmentFilter): Promise<DirectoryRecipient[]> {
    return this.profiles.findSegment(filter);
  }

  /**
   * Grant birthday points (FR-091) to every customer whose DOB is today and who has not
   * been rewarded this year. Admin/scheduler-triggered. Idempotent per year via a stamp
   * written ONLY after a successful grant, so a re-run skips the already-rewarded and
   * retries the ones loyalty failed for. Forwards the admin's token (loyalty/reward is
   * role-guarded). `now` is injectable for testing.
   * ponytail: Feb-29 birthdays only match in leap years; add a Feb-28 fallback if the
   * business wants those rewarded every year.
   */
  async runBirthdayRewards(
    authorization: string,
    now: Date = new Date(),
  ): Promise<BirthdayRewardResult> {
    // H-16: "today" was the UTC date, so the sweep — which the scheduler fires in the
    // early WIB morning — rewarded YESTERDAY's birthdays for seven hours every day, and
    // stamped them under the wrong year on 1 January.
    const date = localDayKey(now, this.config.businessTimeZone);
    const [year, month, day] = date.split('-').map(Number);

    if (!this.config.loyaltyServiceUrl) {
      this.logger.warn('Birthday promo skipped: LOYALTY_SERVICE_URL not configured');
      return { date, candidates: 0, granted: 0, failed: 0, disabled: true };
    }

    const candidates = await this.profiles.findBirthdayCandidates(month, day, year);
    const points = this.config.birthdayRewardPoints;
    let granted = 0;
    let failed = 0;
    for (const customerId of candidates) {
      try {
        await this.loyalty.reward(customerId, points, `Birthday reward ${year}`, authorization);
        await this.profiles.markBirthdayRewarded(customerId, year);
        granted += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(`Birthday reward failed for ${customerId}: ${(error as Error).message}`);
      }
    }
    return { date, candidates: candidates.length, granted, failed, disabled: false };
  }
}
