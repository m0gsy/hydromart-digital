import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';

import { AuthenticatedUser, depotScopeIds } from '@hydromart/platform';

import { AiReadSourcesPort } from '../ports/ai-read-sources.port';
import { DashboardSourcesPort } from '../ports/dashboard-sources.port';
import { DASHBOARD_TOKENS } from '../tokens';
import { AnswerScope } from './envelope';
import { ResolvedPeriod } from './period';

/** A stretch of the period (days, both included) during which a depot belonged to an entity the caller may read. */
export interface GrantedSpan {
  depotId: string;
  legalEntityId: string | null;
  from: string;
  to: string;
}

/**
 * What a metric receives: the granted stretches ONLY. A depot that moved from an entity the
 * caller may not read to one they may, on 10 Nov, is in scope from 10 Nov: a metric must count a
 * fact only if `covers(scope, depotId, factDay)`, or read `grantedRanges(scope, depotId)`, and
 * never take the depot ids of the echo as "the depots to count".
 */
export interface ReadScope {
  spans: GrantedSpan[];
  /** For the envelope's `scope` echo and nothing else. */
  echo: AnswerScope;
}

/** The granted day ranges of one depot. */
export const grantedRanges = (scope: ReadScope, depotId: string): GrantedSpan[] =>
  scope.spans.filter((s) => s.depotId === depotId);

/** Whether a fact of `depotId` dated `day` (`YYYY-MM-DD`, WIB) may be counted. */
export const covers = (scope: ReadScope, depotId: string, day: string): boolean =>
  scope.spans.some((s) => s.depotId === depotId && s.from <= day && day <= s.to);

const dayBefore = (day: string): string => {
  // tz-ok: calendar days as UTC midnights.
  const ms = Date.parse(`${day}T00:00:00Z`) - 86_400_000;
  return new Date(ms).toISOString().slice(0, 10); // tz-ok: a calendar day held as a UTC midnight
};

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
    if (own.length === 0) return { spans: [], echo: { depotIds: [], legalEntityIds: [] } };
    const [spans, grants] = await Promise.all([
      this.sources.entityTimeline(own, period.from, period.to),
      this.sources.aiGrants(user.role),
    ]);
    if (!spans || !grants) throw new ServiceUnavailableException(UNAVAILABLE);
    const granted = new Set(grants.legalEntityIds);
    // Each span ends the day before the same depot's next one, so cut the ends BEFORE dropping
    // the stretches that are not granted.
    const ordered = [...spans].sort((a, b) => a.depotId.localeCompare(b.depotId) || a.from.localeCompare(b.from));
    const kept: GrantedSpan[] = [];
    ordered.forEach((s, i) => {
      const next = ordered[i + 1];
      const to = next && next.depotId === s.depotId ? dayBefore(next.from) : period.to;
      if (grants.all || (s.legalEntityId !== null && granted.has(s.legalEntityId))) {
        kept.push({ depotId: s.depotId, legalEntityId: s.legalEntityId, from: s.from, to });
      }
    });
    return {
      spans: kept,
      echo: {
        depotIds: [...new Set(kept.map((s) => s.depotId))].sort(),
        legalEntityIds: [...new Set(kept.flatMap((s) => (s.legalEntityId ? [s.legalEntityId] : [])))].sort(),
      },
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
