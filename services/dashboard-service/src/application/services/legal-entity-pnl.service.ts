import { Inject, Injectable } from '@nestjs/common';

import { AiReadSourcesPort, DepotEntitySpan } from '../ports/ai-read-sources.port';
import { DASHBOARD_TOKENS } from '../tokens';
import { DashboardService, NetworkPnl, NetworkPnlDepotRow } from './dashboard.service';

export const MOVED_MID_MONTH = 'pindah badan hukum di tengah bulan';

export interface LegalEntityPnlEntity {
  /** null = the depots no legal entity was recorded for. */
  legalEntityId: string | null;
  name: string;
  /** True when the entity's name could not be read: `name` is then a placeholder and the id identifies it. */
  nameUnread: boolean;
  depots: { depotId: string; code: string; name: string }[];
  totals: NetworkPnl['totals'];
}

export interface LegalEntityPnl {
  payVisible: boolean;
  month: string;
  from: string;
  to: string;
  reportType: 'OPERATIONAL_MANAGEMENT';
  disclaimer: string;
  entities: LegalEntityPnlEntity[];
  /** Depots left out of EVERY entity this month, with why. */
  excluded: { depotId: string; code: string; name: string; reason: typeof MOVED_MID_MONTH }[];
  /** The totals of the excluded depots (same null/hidden rules), so the cards + this reconcile with the network total; null when none. */
  excludedTotals: NetworkPnl['totals'] | null;
  sources: NetworkPnl['sources'] & { legalEntities: 'ok' | 'unavailable' };
}

const NONE = 'Belum ada badan hukum';
const UNREAD = 'Badan hukum (nama tidak terbaca)';

/**
 * HD-16 PR-B (owner decisions D22, D25): the monthly P&L of each legal entity. It does not compute a
 * second P&L: it takes the network P&L rows (the one formula) and groups them by the entity that
 * held the depot for the WHOLE month. A depot that changed hands inside the month is in neither
 * entity (its month is two companies' months) and is named under `excluded`. HQ overhead is not
 * allocated.
 */
@Injectable()
export class LegalEntityPnlService {
  constructor(
    private readonly dashboard: DashboardService,
    @Inject(DASHBOARD_TOKENS.AiReadSources) private readonly sources: AiReadSourcesPort,
  ) {}

  async legalEntityPnl(
    month: string,
    token: string,
    depotIds: readonly string[] | undefined,
    payVisible: boolean,
  ): Promise<LegalEntityPnl> {
    const pnl = await this.dashboard.networkPnl(month, token, depotIds, payVisible);
    // tz-ok: a calendar day of the month key, not an instant.
    const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate(); // tz-ok
    const from = `${month}-01`;
    const to = `${month}-${String(last).padStart(2, '0')}`;
    const base = {
      payVisible: pnl.payVisible,
      month,
      from,
      to,
      reportType: pnl.reportType,
      disclaimer:
        'Laporan manajemen operasional per badan hukum. Hanya depot yang dimiliki satu badan hukum selama ' +
        `SEPANJANG bulan yang dihitung; depot yang ${MOVED_MID_MONTH} tidak dimasukkan ke badan hukum mana pun ` +
        'dan disebut di bawah. Biaya kantor pusat tidak dibebankan ke depot maupun badan hukum. ' +
        'Bukan laporan akuntansi statutori maupun surat pemberitahuan pajak.',
    };
    const spans = pnl.depots.length === 0 ? [] : await this.sources.entityTimeline(pnl.depots.map((d) => d.depotId), from, to);
    if (spans === null) {
      return { ...base, entities: [], excluded: [], excludedTotals: null, sources: { ...pnl.sources, legalEntities: 'unavailable' } };
    }

    const byDepot = new Map<string, DepotEntitySpan[]>();
    for (const s of spans) byDepot.set(s.depotId, [...(byDepot.get(s.depotId) ?? []), s]);

    const groups = new Map<string | null, NetworkPnlDepotRow[]>();
    const excluded: LegalEntityPnl['excluded'] = [];
    const excludedRows: NetworkPnlDepotRow[] = [];
    for (const row of pnl.depots) {
      const own = byDepot.get(row.depotId) ?? [];
      // Distinct ENTITIES, not spans: re-asserting the same entity mid-month is no move, while none -> entity is.
      if (new Set(own.map((s) => s.legalEntityId)).size > 1) {
        excludedRows.push(row);
        excluded.push({ depotId: row.depotId, code: row.code, name: row.name, reason: MOVED_MID_MONTH });
        continue;
      }
      const key = own[0]?.legalEntityId ?? null;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    const names = new Map<string, string | null>();
    await Promise.all(
      [...groups.keys()].flatMap((id) => (id === null ? [] : [this.sources.entityName(id).then((n) => void names.set(id, n))])),
    );

    const entities: LegalEntityPnlEntity[] = [...groups.entries()]
      .map(([legalEntityId, rows]) => ({
        legalEntityId,
        // A name that could not be read is shown as the id, never dropped: the numbers still belong to someone.
        name: legalEntityId === null ? NONE : (names.get(legalEntityId) ?? UNREAD),
        nameUnread: legalEntityId !== null && !names.get(legalEntityId),
        depots: rows.map((r) => ({ depotId: r.depotId, code: r.code, name: r.name })),
        totals: DashboardService.pnlTotals(rows),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      ...base,
      entities,
      excluded,
      excludedTotals: excludedRows.length > 0 ? DashboardService.pnlTotals(excludedRows) : null,
      sources: { ...pnl.sources, legalEntities: 'ok' },
    };
  }
}
