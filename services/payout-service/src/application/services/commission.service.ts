import { Inject, Injectable } from '@nestjs/common';

import { InvalidCommissionSchemeError } from '../../domain/errors';
import { CommissionSchemeRecord } from '../../domain/commission';
import { CommissionSchemeRepository } from '../ports/commission-scheme.repository';
import { PAYOUT_TOKENS } from '../tokens';

export interface ApplySchemeItem {
  depotId: string;
  ownerName?: string | null;
  pct: number;
}

export interface ApplySchemeInput {
  effectiveDate: Date;
  items: ApplySchemeItem[];
}

/**
 * Commission schemes (design 21c). Effective-dated per-depot payout percentages.
 * "Terapkan skema baru" appends a new row per depot with the chosen effective date;
 * the current pct per depot is always the latest-dated row (see listCurrent).
 */
@Injectable()
export class CommissionService {
  constructor(
    @Inject(PAYOUT_TOKENS.CommissionSchemeRepository)
    private readonly schemes: CommissionSchemeRepository,
  ) {}

  listCurrent(): Promise<CommissionSchemeRecord[]> {
    return this.schemes.listCurrent();
  }

  async apply(input: ApplySchemeInput): Promise<CommissionSchemeRecord[]> {
    if (input.items.length === 0) return [];
    for (const item of input.items) {
      if (!(item.pct >= 0 && item.pct <= 100)) throw new InvalidCommissionSchemeError();
    }
    return this.schemes.createMany(
      input.items.map((item) => ({
        depotId: item.depotId,
        ownerName: item.ownerName ?? null,
        pct: item.pct,
        effectiveDate: input.effectiveDate,
      })),
    );
  }
}
