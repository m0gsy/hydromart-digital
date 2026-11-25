import { Injectable, Logger } from '@nestjs/common';

import { InstantRange } from '../../application/ports/ai-money-sources.port';
import {
  ATTENDANCE_CELLS,
  AiOrgSourcesPort,
  ApplicationSummary,
  AttendanceHeads,
  AttendanceRow,
  KasbonRow,
  PayrollGateRow,
  PayrollRow,
} from '../../application/ports/ai-org-sources.port';
import { DashboardConfigService } from '../../config/dashboard-config.service';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isList = (v: unknown): v is Record<string, unknown>[] =>
  Array.isArray(v) && v.every((r) => r && typeof r === 'object');

/** Exactly one row per depot asked for, each with these numeric fields: a short or padded answer is no answer. */
function perDepot<T extends { depotId: string }>(rows: unknown, depotIds: readonly string[], fields: readonly string[]): T[] | null {
  if (!isList(rows) || rows.length !== depotIds.length) return null;
  const ok = rows.every((r) => typeof r.depotId === 'string' && fields.every((f) => isNum(r[f])));
  if (!ok || new Set(rows.map((r) => r.depotId)).size !== depotIds.length) return null;
  const asked = new Set(depotIds);
  return rows.every((r) => asked.has(r.depotId as string)) ? (rows as unknown as T[]) : null;
}

/**
 * HD-6 H5: reads the franchise, legal-entity, HR and commission facts from depot, hr and payout
 * service with the internal key. Any failure, an unwired service, or an answer that is not the shape
 * (and the size) asked for is null, so a metric says belum_ada rather than answer from a partial read.
 */
@Injectable()
export class AiOrgSourcesHttpAdapter implements AiOrgSourcesPort {
  private static readonly TIMEOUT_MS = 8000;
  private readonly logger = new Logger(AiOrgSourcesHttpAdapter.name);

  constructor(private readonly config: DashboardConfigService) {}

  private async get(url: string): Promise<unknown | null> {
    const where = url.split('?')[0];
    try {
      const res = await fetch(url, {
        headers: { 'x-internal-key': this.config.internalServiceKey, accept: 'application/json' },
        signal: AbortSignal.timeout(AiOrgSourcesHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`${where} answered ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (error) {
      this.logger.warn(`${where} unreachable: ${(error as Error).message}`);
      return null;
    }
  }

  private q(params: Record<string, string>): string {
    return new URLSearchParams(params).toString();
  }

  async applications(range: InstantRange): Promise<ApplicationSummary | null> {
    const body = (await this.get(
      `${this.config.depotServiceUrl}/api/v1/franchise-applications/internal/summary?${this.q({ ...range })}`,
    )) as { total?: unknown; byStage?: unknown } | null;
    const by = body?.byStage as Record<string, unknown> | undefined;
    if (!body || !isNum(body.total) || !by || typeof by !== 'object') return null;
    const stages = Object.entries(by);
    if (!stages.every(([, n]) => isNum(n))) return null;
    return { total: body.total, byStage: Object.fromEntries(stages) as Record<string, number> };
  }

  /** At most 100 entities a call (depot-service refuses more), so a longer list is asked in parts. */
  async entityKinds(ids: readonly string[]): Promise<Map<string, string> | null> {
    const kinds = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 100) {
      const part = ids.slice(i, i + 100);
      const body = (await this.get(
        `${this.config.depotServiceUrl}/api/v1/legal-entities/internal/kinds?${this.q({ ids: part.join(',') })}`,
      )) as { entities?: unknown } | null;
      const rows = body?.entities;
      if (!isList(rows) || !rows.every((r) => typeof r.id === 'string' && typeof r.kind === 'string')) return null;
      for (const r of rows) kinds.set(r.id as string, r.kind as string);
      // An entity the service does not know is a scope it could not resolve: no answer.
      if (!part.every((id) => kinds.has(id.toLowerCase()))) return null;
    }
    return kinds;
  }

  async commission(depotIds: readonly string[], range: InstantRange): Promise<{ depotId: string; commissionIdr: number }[] | null> {
    const base = this.config.payoutServiceUrl;
    if (!base) return null;
    const body = await this.get(
      `${base}/api/v1/payout/internal/commission-by-depot?${this.q({ depotIds: depotIds.join(','), ...range })}`,
    );
    return perDepot(body, depotIds, ['commissionIdr']);
  }

  async attendance(depotIds: readonly string[], from: string, to: string): Promise<{ rows: AttendanceRow[]; heads: AttendanceHeads; rolledUp: boolean } | null> {
    const base = this.config.hrServiceUrl;
    if (!base) return null;
    const body = (await this.get(
      `${base}/api/v1/hr-reports/internal/ai/attendance?${this.q({ depotIds: depotIds.join(','), from, to })}`,
    )) as { rows?: unknown; rolledUp?: unknown } | null;
    const rows = perDepot<AttendanceRow>(body?.rows, depotIds, ATTENDANCE_CELLS);
    const raw = (body as { heads?: Record<string, unknown> } | null)?.heads;
    const lists = ATTENDANCE_CELLS.map((c) => raw?.[c]);
    const heads = lists.every((l) => Array.isArray(l) && l.every((id) => typeof id === 'string'))
      ? (Object.fromEntries(ATTENDANCE_CELLS.map((c, i) => [c, lists[i]])) as AttendanceHeads)
      : null;
    return rows && heads && typeof body?.rolledUp === 'boolean' ? { rows, heads, rolledUp: body.rolledUp } : null;
  }

  async payrollGate(depotIds: readonly string[], month: string): Promise<PayrollGateRow[] | null> {
    const base = this.config.hrServiceUrl;
    if (!base) return null;
    const body = await this.get(
      `${base}/api/v1/hr-reports/internal/ai/payroll-gate?${this.q({ depotIds: depotIds.join(','), month })}`,
    );
    return perDepot<PayrollGateRow>(body, depotIds, ['expected', 'draft', 'final']);
  }

  async payroll(depotIds: readonly string[], month: string): Promise<PayrollRow[] | null> {
    const base = this.config.hrServiceUrl;
    if (!base) return null;
    const body = await this.get(
      `${base}/api/v1/hr-reports/internal/ai/payroll?${this.q({ depotIds: depotIds.join(','), month })}`,
    );
    return perDepot<PayrollRow>(body, depotIds, ['slips', 'grossIdr', 'bonusIdr', 'deductionIdr', 'netIdr', 'gallonBonusIdr', 'gallonPeople']);
  }

  async kasbon(depotIds: readonly string[], month: string): Promise<KasbonRow[] | null> {
    const base = this.config.hrServiceUrl;
    if (!base) return null;
    const body = await this.get(
      `${base}/api/v1/hr-reports/internal/ai/kasbon?${this.q({ depotIds: depotIds.join(','), month })}`,
    );
    return perDepot<KasbonRow>(body, depotIds, ['people', 'remainingIdr']);
  }
}
