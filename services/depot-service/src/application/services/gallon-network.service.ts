import { Inject, Injectable } from '@nestjs/common';

import { GallonIssueRepository } from '../ports/gallon-issue.repository';
import { GallonReturnRepository } from '../ports/gallon-return.repository';
import { DEPOT_TOKENS } from '../tokens';

/** One depot's outstanding empties + net deposit held across the whole ledger. */
export interface GallonOutstandingRow {
  depotId: string;
  issued: number;
  returned: number;
  /** Empties still at customers = issued − returned (floored at 0). */
  outstanding: number;
  depositHeld: number;
  depositRefunded: number;
  /** Deposit still held by the depot = depositHeld − depositRefunded (floored at 0). */
  netDeposit: number;
}

/**
 * Network gallon rollup (HQ compare 14d + reconciliation 22a). Merges the per-depot
 * issue and return group-bys into outstanding empties + net deposit held. One row per
 * depot that has any issue or return activity.
 */
@Injectable()
export class GallonNetworkService {
  constructor(
    @Inject(DEPOT_TOKENS.GallonIssueRepository) private readonly issues: GallonIssueRepository,
    @Inject(DEPOT_TOKENS.GallonReturnRepository) private readonly returns: GallonReturnRepository,
  ) {}

  async outstanding(): Promise<GallonOutstandingRow[]> {
    const [issued, returned] = await Promise.all([
      this.issues.networkSummary(),
      this.returns.networkSummary(),
    ]);

    const rows = new Map<string, GallonOutstandingRow>();
    const row = (depotId: string): GallonOutstandingRow => {
      let r = rows.get(depotId);
      if (!r) {
        r = { depotId, issued: 0, returned: 0, outstanding: 0, depositHeld: 0, depositRefunded: 0, netDeposit: 0 };
        rows.set(depotId, r);
      }
      return r;
    };

    for (const i of issued) {
      const r = row(i.depotId);
      r.issued = i.gallons;
      r.depositHeld = i.depositHeld;
    }
    for (const ret of returned) {
      const r = row(ret.depotId);
      r.returned = ret.gallons;
      r.depositRefunded = ret.depositRefunded;
    }
    for (const r of rows.values()) {
      r.outstanding = Math.max(0, r.issued - r.returned);
      r.netDeposit = Math.max(0, r.depositHeld - r.depositRefunded);
    }
    return [...rows.values()];
  }
}
