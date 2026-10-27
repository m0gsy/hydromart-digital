import { Injectable, Logger } from '@nestjs/common';

import { ReportDataset } from '../../domain/report-dataset';
import {
  ReportRow,
  ReportSourcePort,
  ReportWindow,
} from '../../application/ports/report-source.port';
import {
  ReportCell,
  ReportColumn,
  ReportTable,
  comparisonTable,
  revenueTable,
} from '../../domain/report-table';
import { AdminConfigService } from '../../config/admin-config.service';

type Service = 'order' | 'payment' | 'delivery' | 'promo' | 'hr' | 'depot';

/** The three revenue groupings: label/orders/revenue rows, with a comparison against the period before. */
const REVENUE: Partial<Record<ReportDataset, { service: 'order' | 'payment'; path: string }>> = {
  [ReportDataset.REVENUE_BY_DEPOT]: {
    service: 'order',
    path: 'reports/internal/export-rows?dataset=REVENUE_BY_DEPOT',
  },
  [ReportDataset.REVENUE_BY_PRODUCT]: {
    service: 'order',
    path: 'reports/internal/export-rows?dataset=REVENUE_BY_PRODUCT',
  },
  [ReportDataset.REVENUE_BY_METHOD]: {
    service: 'payment',
    path: 'payments/internal/export-rows?',
  },
};

/**
 * Every other dataset: the owning service answers `{ columns, rows, truncated }` on its own
 * `internal/report-table` route, and this adapter lays no opinion on top of it.
 */
const TABLE: Partial<Record<ReportDataset, { service: Service; path: string }>> = {
  [ReportDataset.ORDERS_DETAIL]: { service: 'order', path: 'reports/internal/report-table' },
  [ReportDataset.NEW_VS_REPEAT]: { service: 'order', path: 'reports/internal/report-table' },
  [ReportDataset.COD_UNSETTLED]: { service: 'delivery', path: 'settlements/internal/report-table' },
  [ReportDataset.FAILED_DELIVERIES]: {
    service: 'delivery',
    path: 'settlements/internal/report-table',
  },
  [ReportDataset.PROMO_COST]: { service: 'promo', path: 'promotions/internal/report-table' },
  [ReportDataset.KASBON_BALANCE]: { service: 'hr', path: 'loan-requests/internal/report-table' },
  [ReportDataset.STOCK_LEVELS]: { service: 'depot', path: 'reports/internal/report-table' },
  [ReportDataset.METER_READINGS]: { service: 'order', path: 'reports/internal/report-table' },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TableBody {
  columns: ReportColumn[];
  rows: ReportCell[][];
  truncated?: boolean;
}

/**
 * Reads a scheduled report's rows from the service that owns them, under the shared
 * internal key — the caller is cron, which holds no bearer.
 *
 * THROWS on every unhappy path. An empty spreadsheet is a real answer about a quiet month,
 * so a service that could not be reached must never be able to produce one; the sweep
 * records those runs as FAILED and `hq/exports` shows the failure instead.
 */
@Injectable()
export class ReportSourceHttpAdapter implements ReportSourcePort {
  private static readonly TIMEOUT_MS = 15_000;
  private readonly logger = new Logger(ReportSourceHttpAdapter.name);

  constructor(private readonly config: AdminConfigService) {}

  async rowsFor(dataset: ReportDataset, from: Date, to: Date): Promise<ReportRow[]> {
    const { rows, truncated } = await this.revenueRows(dataset, from, to);
    /*
     * E-4: the row source caps at 100 and used to say nothing about it, so a network past
     * its 100th depot handed finance a spreadsheet that simply stopped — a short month and
     * a cut-off month are the same file once the cap is invisible.
     *
     * ponytail: the warning is a final ROW rather than a column or a status on the run,
     * because the row is what lands in the file somebody actually opens. Zeroed figures so
     * a spreadsheet SUM over the column is unchanged by it.
     */
    if (truncated) {
      this.logger.warn(`report rows for ${dataset} were truncated by the source's row cap`);
      return [...rows, { label: truncatedNote(rows.length), orders: 0, revenue: 0 }];
    }
    return rows;
  }

  /**
   * The finished table. Revenue datasets carry the previous period beside this one; every
   * other dataset is whatever columns its owning service sent.
   */
  async tableFor(
    dataset: ReportDataset,
    from: Date,
    to: Date,
    previous?: ReportWindow,
  ): Promise<ReportTable> {
    if (REVENUE[dataset]) {
      const current = await this.rowsFor(dataset, from, to);
      // No previous window (a direct caller) keeps the three-column shape.
      if (!previous) return revenueTable(current);
      // Throws like any other read: a comparison against a period that could not be fetched
      // would show every depot as brand new.
      const before = await this.revenueRows(dataset, previous.from, previous.to);
      return comparisonTable(current, before.rows);
    }
    const route = TABLE[dataset];
    if (!route) throw new Error(`Dataset ${dataset} belum punya sumber data.`);
    const body = await this.get<TableBody>(route, `dataset=${dataset}`, from, to);
    if (!Array.isArray(body.columns) || !Array.isArray(body.rows)) {
      throw new Error(`${route.service}-service answered ${dataset} in an unknown shape`);
    }
    const rows = await this.withNames(body.columns, body.rows);
    if (body.truncated) {
      this.logger.warn(`report table ${dataset} was truncated by the source's row cap`);
      const note: ReportCell[] = body.columns.map(() => null);
      note[0] = truncatedNote(body.rows.length);
      return { columns: body.columns, rows: [...rows, note] };
    }
    return { columns: body.columns, rows };
  }

  /**
   * delivery-service stores courier and depot as bare ids, so its tables arrive as columns of
   * uuids — unreadable in a file head office opens. Names are looked up here, once per file,
   * for the `depot` and `courier` columns only.
   *
   * Fail-SOFT, unlike the table read itself: a name is decoration on a number that is already
   * right, so an unreachable directory leaves the id in the cell instead of failing the run.
   */
  private async withNames(columns: ReportColumn[], rows: ReportCell[][]): Promise<ReportCell[][]> {
    const idx = (key: string): number => columns.findIndex((c) => c.key === key);
    const depotAt = idx('depot');
    const courierAt = idx('courier');
    const isId = (v: ReportCell): v is string => typeof v === 'string' && UUID.test(v);
    const wanted = (at: number): string[] =>
      at < 0 ? [] : [...new Set(rows.map((r) => r[at]).filter(isId))];
    const depotIds = wanted(depotAt);
    const courierIds = wanted(courierAt);
    if (depotIds.length === 0 && courierIds.length === 0) return rows;

    const [depots, couriers] = await Promise.all([
      depotIds.length ? this.depotNames() : new Map<string, string>(),
      courierIds.length ? this.userNames(courierIds) : new Map<string, string>(),
    ]);
    return rows.map((r) => {
      const next = [...r];
      if (isId(r[depotAt])) next[depotAt] = depots.get(r[depotAt] as string) ?? r[depotAt];
      if (isId(r[courierAt]))
        next[courierAt] = couriers.get(r[courierAt] as string) ?? r[courierAt];
      return next;
    });
  }

  private async depotNames(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const base = this.config.peerUrl('DEPOT_SERVICE_URL');
    const key = this.config.internalServiceKey;
    if (!base || !key) return out;
    try {
      const res = await fetch(`${base}/api/v1/depots/internal/contacts`, {
        headers: { 'x-internal-key': key },
        signal: AbortSignal.timeout(ReportSourceHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) return out;
      const body = (await res.json()) as { depots?: { id: string; name: string }[] };
      for (const d of body.depots ?? []) out.set(d.id, d.name);
    } catch (error) {
      this.logger.debug(`depot names unresolved: ${(error as Error).message}`);
    }
    return out;
  }

  /** auth-service answers at most 200 ids a call, so a long list goes in batches. */
  private async userNames(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const base = this.config.peerUrl('AUTH_SERVICE_URL');
    const key = this.config.internalServiceKey;
    if (!base || !key) return out;
    for (let i = 0; i < ids.length; i += 200) {
      try {
        const res = await fetch(`${base}/api/v1/auth/internal/customers/by-ids`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-internal-key': key },
          body: JSON.stringify({ ids: ids.slice(i, i + 200) }),
          signal: AbortSignal.timeout(ReportSourceHttpAdapter.TIMEOUT_MS),
        });
        if (!res.ok) continue;
        const users = (await res.json()) as { id?: string; fullName?: string | null }[];
        for (const u of users) if (u.id && u.fullName) out.set(u.id, u.fullName);
      } catch (error) {
        this.logger.debug(`courier names unresolved: ${(error as Error).message}`);
      }
    }
    return out;
  }

  private revenueRows(
    dataset: ReportDataset,
    from: Date,
    to: Date,
  ): Promise<{ rows: ReportRow[]; truncated?: boolean }> {
    const source = REVENUE[dataset];
    if (!source) throw new Error(`${dataset} is not a revenue dataset`);
    const [path, query = ''] = source.path.split('?');
    return this.get<{ rows: ReportRow[]; truncated?: boolean }>(
      { service: source.service, path },
      query,
      from,
      to,
    );
  }

  /** One authenticated read of a peer's report route. THROWS on every unhappy path. */
  private async get<T>(
    route: { service: Service; path: string },
    query: string,
    from: Date,
    to: Date,
  ): Promise<T> {
    const base = this.config.peerUrl(`${route.service.toUpperCase()}_SERVICE_URL`);
    if (!base) throw new Error(`${route.service}-service URL not configured`);
    const key = this.config.internalServiceKey;
    if (!key) throw new Error('INTERNAL_SERVICE_KEY not configured');

    const window = `from=${from.toISOString()}&to=${to.toISOString()}`;
    const url = `${base}/api/v1/${route.path}?${query ? `${query}&` : ''}${window}`;

    const res = await fetch(url, {
      headers: { 'x-internal-key': key },
      signal: AbortSignal.timeout(ReportSourceHttpAdapter.TIMEOUT_MS),
    });
    if (!res.ok) {
      this.logger.warn(`report read ${route.path} failed: ${res.status}`);
      throw new Error(`${route.service}-service responded ${res.status}`);
    }
    return (await res.json()) as T;
  }
}

function truncatedNote(kept: number): string {
  return `— TERPOTONG: hanya ${kept} baris teratas yang masuk laporan ini —`;
}
