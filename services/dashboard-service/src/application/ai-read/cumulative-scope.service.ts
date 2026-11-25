import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';

import { AuthenticatedUser } from '@hydromart/platform';

import { AiReadSourcesPort } from '../ports/ai-read-sources.port';
import { DASHBOARD_TOKENS } from '../tokens';

/** Far enough back to hold every depot's first recorded legal entity. */
const EPOCH_DAY = '2000-01-01';

export interface HeldBackDepot {
  depotId: string;
  /** The first day of the unbroken run that the role may read up to the as-of day; null when it may not read the depot that day. */
  since: string | null;
}

export interface CumulativeSplit {
  /** Depots whose WHOLE history up to the as-of day the caller may read. */
  readable: string[];
  heldBack: HeldBackDepot[];
}

/**
 * HD-6: a metric that adds up ALL history (a balance, the people who ever ordered, orders of any age)
 * reads a depot's facts from before the day it became readable. So such a metric may only answer for a
 * depot whose every legal-entity stretch up to the as-of day is one the role may read; a depot that
 * joined a readable entity only recently is held back, never silently mixed in.
 */
@Injectable()
export class CumulativeScopeService {
  constructor(@Inject(DASHBOARD_TOKENS.AiReadSources) private readonly sources: AiReadSourcesPort) {}

  async split(user: AuthenticatedUser, depotIds: readonly string[], asOf: string): Promise<CumulativeSplit> {
    if (depotIds.length === 0) return { readable: [], heldBack: [] };
    const [spans, grants] = await Promise.all([this.sources.entityTimeline(depotIds, EPOCH_DAY, asOf), this.sources.aiGrants(user.role)]);
    if (!spans || !grants) throw new ServiceUnavailableException('Cakupan badan hukum belum bisa dipastikan sekarang; coba lagi nanti.');
    const granted = new Set(grants.legalEntityIds);
    const mayRead = (entity: string | null): boolean => grants.all || (entity !== null && granted.has(entity));
    const readable: string[] = [];
    const heldBack: HeldBackDepot[] = [];
    for (const depotId of [...new Set(depotIds)].sort()) {
      const own = spans.filter((s) => s.depotId === depotId).sort((a, b) => a.from.localeCompare(b.from));
      if (own.length > 0 && own.every((s) => mayRead(s.legalEntityId))) {
        readable.push(depotId);
        continue;
      }
      // The unbroken run of readable stretches that ends at the as-of day, if there is one.
      let since: string | null = null;
      for (let i = own.length - 1; i >= 0 && mayRead(own[i].legalEntityId); i--) since = own[i].from;
      heldBack.push({ depotId, since });
    }
    return { readable, heldBack };
  }
}

/** What the answer says about the depots it could not include: how many, and since when the rest may be read. */
export function heldBackNote(heldBack: readonly HeldBackDepot[]): string {
  if (heldBack.length === 0) return '';
  const dates = [...new Set(heldBack.flatMap((h) => (h.since ? [h.since] : [])))].sort();
  const when = dates.length > 0 ? `; ${dates.length === 1 ? 'satu' : 'beberapa'} baru boleh dibaca sejak ${dates.join(', ')}` : '';
  return `; ${heldBack.length} depot ditahan karena riwayatnya sebelum hari boleh dibaca tidak ikut dijawab${when}`;
}
