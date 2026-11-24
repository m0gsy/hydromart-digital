import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';

import { AuthenticatedUser, depotScopeIds } from '@hydromart/platform';

import { AiReadSourcesPort, DepotEntitySpan } from '../ports/ai-read-sources.port';
import { DashboardSourcesPort } from '../ports/dashboard-sources.port';
import { DASHBOARD_TOKENS } from '../tokens';
import { AnswerScope } from './envelope';
import { ResolvedPeriod } from './period';

export interface ReadScope extends AnswerScope {
  /**
   * The stretches of the period during which each in-scope depot belonged to an entity the caller
   * may read, for a metric that must count each fact under the entity of ITS date (HD-6 H2+).
   */
  spans: DepotEntitySpan[];
}

const UNAVAILABLE = 'Cakupan badan hukum belum bisa dipastikan sekarang; coba lagi nanti.';

/**
 * HD-6, owner decisions 22-24 Nov 2026: what the caller may read through the AI read API.
 *  1. Their own depot scope, as every staff screen resolves it (a network-wide role: every depot).
 *  2. Narrowed to the depots whose legal entity at some point of the period is one their ROLE is
 *     granted (HD-5; no row = SUPER_ADMIN only). A grant never widens step 1.
 * Fails closed: when depot-service cannot say, nothing is answered.
 */
@Injectable()
export class ReadScopeService {
  constructor(
    @Inject(DASHBOARD_TOKENS.AiReadSources) private readonly sources: AiReadSourcesPort,
    @Inject(DASHBOARD_TOKENS.Sources) private readonly depots: DashboardSourcesPort,
  ) {}

  async resolve(user: AuthenticatedUser, period: ResolvedPeriod): Promise<ReadScope> {
    const own = await this.ownDepots(user);
    if (own.length === 0) return { depotIds: [], legalEntityIds: [], spans: [] };
    const [spans, grants] = await Promise.all([
      this.sources.entityTimeline(own, period.from, period.to),
      this.sources.aiGrants(user.role),
    ]);
    if (!spans || !grants) throw new ServiceUnavailableException(UNAVAILABLE);
    const granted = new Set(grants.legalEntityIds);
    const kept = spans.filter((s) => grants.all || (s.legalEntityId !== null && granted.has(s.legalEntityId)));
    return {
      depotIds: [...new Set(kept.map((s) => s.depotId))].sort(),
      legalEntityIds: [...new Set(kept.flatMap((s) => (s.legalEntityId ? [s.legalEntityId] : [])))].sort(),
      spans: kept,
    };
  }

  /** Step 1. A scoped account with no depot at all reads nothing (it is not an error to ask). */
  private async ownDepots(user: AuthenticatedUser): Promise<string[]> {
    let scope: readonly string[] | undefined;
    try {
      scope = depotScopeIds(user);
    } catch {
      return [];
    }
    if (scope) return [...new Set(scope)];
    const all = await this.depots.allDepots('');
    if (!all) throw new ServiceUnavailableException(UNAVAILABLE);
    return all.map((d) => d.id);
  }
}
