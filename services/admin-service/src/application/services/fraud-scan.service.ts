import { Inject, Injectable, Logger } from '@nestjs/common';

import { FraudEntityType, FraudLevel, FraudStatus } from '../../domain/fraud';
import { FraudFlagRepository } from '../ports/fraud-flag.repository';
import { FraudSignalsPort } from '../ports/fraud-signals.port';
import { ADMIN_TOKENS } from '../tokens';
import { AdminConfigService } from '../../config/admin-config.service';

export interface FraudScanResult {
  /** Customers the scan judged. */
  scanned: number;
  /** Flags actually raised — always ≤ scanned, because an open flag is not raised twice. */
  flagged: number;
  /** Already carrying a flag a human has not finished with. */
  skipped: number;
  /** True when the signals could not be read at all: `scanned: 0` then means nothing. */
  unavailable: boolean;
  /**
   * J7: the mirror of `unavailable`, in the one field `scripts/scheduler/sweep.sh` reads.
   *
   * This result already said, honestly, that a scan which could read nothing means
   * nothing. The scheduler never looked: HTTP 200 refreshed the heartbeat, so a daily
   * scan that had not seen a signal in weeks was indistinguishable from a clean month.
   */
  ok: boolean;
}

/**
 * The scheduled fraud scan (design 15b).
 *
 * `/hq/fraud` could list, review, block and clear flags, and nothing anywhere raised one —
 * so the queue was permanently whatever had been inserted by hand, and every verb on that
 * screen acted on a list that could not grow.
 *
 * ONE rule, deliberately: customers with repeated settled refunds in a window. 15b says a
 * fraud queue exists and never says what makes something suspicious, so the scan starts
 * where the data is unambiguous — a refund has a timestamp and an owner, and nothing about
 * intent has to be guessed. See `FraudSignalsPort` for what was left out and why.
 *
 * A flag is a REVIEW ITEM, not a verdict: nothing here blocks an account. Someone decides.
 */
@Injectable()
export class FraudScanService {
  private readonly logger = new Logger(FraudScanService.name);

  constructor(
    @Inject(ADMIN_TOKENS.FraudFlagRepository) private readonly flags: FraudFlagRepository,
    @Inject(ADMIN_TOKENS.FraudSignals) private readonly signals: FraudSignalsPort,
    private readonly config: AdminConfigService,
  ) {}

  async run(now = new Date()): Promise<FraudScanResult> {
    const { windowDays, minRefunds, highRefunds } = this.config.fraudScan;
    const from = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

    const customers = await this.signals.repeatedRefunds(from, now, minRefunds);
    if (customers === null) {
      // Nothing was scanned, and saying "0 flagged" here would read as a clean week.
      return { scanned: 0, flagged: 0, skipped: 0, unavailable: true, ok: false };
    }

    /*
     * A daily scan over a rolling window sees the same customer every day until their
     * refunds age out. Raising a fresh flag each morning buries the reviewer in duplicates
     * of one case; anything a human has not finished with is left alone.
     */
    const openFlags = await this.flags.list({ status: FraudStatus.OPEN });
    const alreadyOpen = new Set(openFlags.map((f) => f.entityRef));

    let flagged = 0;
    let skipped = 0;
    for (const c of customers) {
      if (alreadyOpen.has(c.customerId)) {
        skipped += 1;
        continue;
      }
      await this.flags.create({
        entityType: FraudEntityType.ACCOUNT,
        entityRef: c.customerId,
        score: c.refunds,
        level: c.refunds >= highRefunds ? FraudLevel.HIGH : FraudLevel.MEDIUM,
        // The signal says what was counted and over what window, so a reviewer can check
        // the claim instead of trusting a score.
        signals: [
          `${c.refunds} refund dalam ${windowDays} hari`,
          `total Rp ${c.amountIdr.toLocaleString('id-ID')}`,
        ],
        status: FraudStatus.OPEN,
      });
      flagged += 1;
    }

    this.logger.log(
      `Fraud scan: ${customers.length} customer(s) over the threshold, ${flagged} flagged, ${skipped} already open`,
    );
    return { scanned: customers.length, flagged, skipped, unavailable: false, ok: true };
  }
}
