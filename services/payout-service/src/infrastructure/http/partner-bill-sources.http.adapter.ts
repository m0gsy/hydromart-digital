import { Injectable, Logger } from '@nestjs/common';

import { PartnerBillSources } from '../../application/ports/partner-bill-sources.port';
import { PayoutConfigService } from '../../config/payout-config.service';
import { PartnerBillSourceUnavailableError } from '../../domain/errors.partner-bill';
import { EntitySpan, PartnerBillBank } from '../../domain/partner-bill';

const isSpan = (v: unknown): v is EntitySpan => {
  const s = v as Partial<EntitySpan> | null;
  return (
    typeof s?.depotId === 'string' &&
    (s.legalEntityId === null || typeof s.legalEntityId === 'string') &&
    typeof s.from === 'string'
  );
};

/**
 * HD-23: depot-service's internal legal-entity routes, the same ones the AI read API uses. A
 * bill is money, so every read FAILS CLOSED: an entity timeline that cannot be read would put a
 * depot's commission on the wrong bill, so the run refuses and nothing is written.
 */
@Injectable()
export class PartnerBillSourcesHttpAdapter implements PartnerBillSources {
  private static readonly TIMEOUT_MS = 8000;
  private static readonly DEPOTS_PER_CALL = 100;
  private readonly logger = new Logger(PartnerBillSourcesHttpAdapter.name);

  constructor(private readonly config: PayoutConfigService) {}

  private async get(path: string): Promise<{ status: number; body: unknown }> {
    const base = this.config.depotServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) throw new PartnerBillSourceUnavailableError('depot-service');
    try {
      const res = await fetch(`${base}/api/v1/${path}`, {
        headers: { 'x-internal-key': key, accept: 'application/json' },
        signal: AbortSignal.timeout(PartnerBillSourcesHttpAdapter.TIMEOUT_MS),
      });
      if (res.status === 404) return { status: 404, body: null };
      if (!res.ok) throw new Error(`answered ${res.status}`);
      return { status: res.status, body: await res.json() };
    } catch (error) {
      this.logger.warn(`depot-service ${path.split('?')[0]}: ${(error as Error).message}`);
      throw new PartnerBillSourceUnavailableError('depot-service');
    }
  }

  async entityTimeline(depotIds: readonly string[], fromDay: string, toDay: string): Promise<EntitySpan[]> {
    const size = PartnerBillSourcesHttpAdapter.DEPOTS_PER_CALL;
    const spans: EntitySpan[] = [];
    for (let i = 0; i < depotIds.length; i += size) {
      const query = new URLSearchParams({ from: fromDay, to: toDay, depotIds: depotIds.slice(i, i + size).join(',') });
      const { body } = await this.get(`legal-entities/internal/depot-entities?${query}`);
      const rows = (body as { spans?: unknown } | null)?.spans;
      if (!Array.isArray(rows) || !rows.every(isSpan)) throw new PartnerBillSourceUnavailableError('depot-service');
      spans.push(...rows);
    }
    return spans;
  }

  async entities(ids: readonly string[]): Promise<{ id: string; name: string; kind: string }[]> {
    const found: { id: string; name: string; kind: string }[] = [];
    // One small read per entity (a handful of partners), which also gives the name for the bill.
    for (const id of ids) {
      const { status, body } = await this.get(`legal-entities/internal/${encodeURIComponent(id)}`);
      const e = body as { name?: unknown; kind?: unknown } | null;
      if (status === 404 || typeof e?.name !== 'string' || typeof e.kind !== 'string') continue;
      found.push({ id, name: e.name, kind: e.kind });
    }
    return found;
  }

  async officialAccount(): Promise<PartnerBillBank | null> {
    const { status, body } = await this.get('legal-entities/internal/franchisor');
    if (status === 404) return null;
    const a = (body as { bankAccount?: Partial<PartnerBillBank> | null } | null)?.bankAccount;
    return a?.bankName && a.bankAccountNumber && a.bankAccountHolder
      ? { bankName: a.bankName, bankAccountNumber: a.bankAccountNumber, bankAccountHolder: a.bankAccountHolder }
      : null;
  }

  async depotName(depotId: string): Promise<string> {
    try {
      const { body } = await this.get(`depots/internal/${encodeURIComponent(depotId)}/active`);
      const name = (body as { name?: unknown } | null)?.name;
      return typeof name === 'string' && name ? name : depotId;
    } catch {
      // A label only: a bill is never refused for a name it could not read.
      return depotId;
    }
  }
}
