import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { CustomerConfigService } from '../../config/customer-config.service';
import {
  CustomerIdentity,
  IdentityPort,
  PreRegisterResult,
} from '../../application/ports/identity.port';

/**
 * Pre-registers imported customers through auth-service's internal route. Fails HARD
 * (unlike the fail-open catalog adapter): the import row is the caller's own write, so
 * an unreachable auth-service must surface as that row failing.
 */
@Injectable()
export class IdentityHttpAdapter implements IdentityPort {
  private readonly logger = new Logger(IdentityHttpAdapter.name);

  private static readonly TIMEOUT_MS = 5000;
  /** auth-service caps a single lookup at 200 ids; a depot can hold more than that. */
  private static readonly BATCH = 200;

  constructor(private readonly config: CustomerConfigService) {}

  async preRegisterCustomer(phone: string, fullName?: string): Promise<PreRegisterResult> {
    const base = this.config.authServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) {
      throw new ServiceUnavailableException('AUTH_SERVICE_URL/INTERNAL_SERVICE_KEY belum diset');
    }

    let res: Response;
    try {
      res = await fetch(`${base.replace(/\/$/, '')}/api/v1/auth/internal/customers/pre-register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': key },
        body: JSON.stringify({ phone, fullName }),
        signal: AbortSignal.timeout(IdentityHttpAdapter.TIMEOUT_MS),
      });
    } catch (err) {
      throw new ServiceUnavailableException(
        `Gagal menghubungi auth-service: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }

    if (!res.ok) {
      throw new ServiceUnavailableException(`auth-service menolak nomor ini (${res.status})`);
    }
    const body = (await res.json()) as Partial<PreRegisterResult>;
    if (!body.customerId || !body.status) {
      throw new ServiceUnavailableException('auth-service tidak mengembalikan identitas');
    }
    return { customerId: body.customerId, status: body.status };
  }

  /**
   * Fail-SOFT on purpose: this only decorates a directory the caller can already render.
   * An unreachable auth-service must degrade the names, never 503 the depot's customer list.
   */
  async getCustomerNames(ids: string[]): Promise<Map<string, CustomerIdentity>> {
    return this.lookup(ids, false);
  }

  /**
   * Fail-HARD twin, for a campaign audience: a batch that did not answer is an outage, not
   * "these people have no account" — dropping them would send the campaign to part of the
   * audience and report success.
   */
  async getAccountOwners(ids: string[]): Promise<Map<string, CustomerIdentity>> {
    return this.lookup(ids, true);
  }

  private async lookup(ids: string[], strict: boolean): Promise<Map<string, CustomerIdentity>> {
    const out = new Map<string, CustomerIdentity>();
    const base = this.config.authServiceUrl;
    const key = this.config.internalServiceKey;
    const unique = [...new Set(ids.filter((id) => id.length > 0))];
    if (unique.length === 0) return out;
    if (!base || !key) {
      if (strict) throw new ServiceUnavailableException('AUTH_SERVICE_URL/INTERNAL_SERVICE_KEY belum diset');
      return out;
    }

    const url = `${base.replace(/\/$/, '')}/api/v1/auth/internal/customers/by-ids`;
    const batches: string[][] = [];
    for (let i = 0; i < unique.length; i += IdentityHttpAdapter.BATCH) {
      batches.push(unique.slice(i, i + IdentityHttpAdapter.BATCH));
    }
    // Side by side: a 5000-row directory page is 25 batches, and one after another they
    // outlasted the caller's own 5 s timeout.
    await Promise.all(
      batches.map(async (batch) => {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-internal-key': key },
            body: JSON.stringify({ ids: batch }),
            signal: AbortSignal.timeout(IdentityHttpAdapter.TIMEOUT_MS),
          });
          if (!res.ok) throw new Error(`auth-service responded ${res.status}`);
          const rows = (await res.json()) as {
            id?: string;
            fullName?: string | null;
            phone?: string | null;
          }[];
          for (const r of rows) {
            if (r.id) out.set(r.id, { fullName: r.fullName ?? null, phone: r.phone ?? null });
          }
        } catch (error) {
          if (strict) {
            throw new ServiceUnavailableException(
              `auth-service tidak menjawab: ${(error as Error).message}`,
            );
          }
          // degrade this batch to "no account name" — the caller keeps its own fallback.
          // Q-4: at debug, not warn: a customer list rendering without account names is a
          // cosmetic degrade, but with no log at all an auth-service outage looked like a
          // data problem in customer-service.
          this.logger.debug(
            `identity batch of ${batch.length} unresolved: ${(error as Error).message}`,
          );
        }
      }),
    );
    return out;
  }
}
