import { ServiceUnavailableException } from '@nestjs/common';

const TIMEOUT_MS = 5_000;

/** Who an account reports to, as depot-service records it. `null` = nobody recorded. */
export type SuperiorResolver = (staffId: string) => Promise<string | null>;

/**
 * Read a reporting line from depot-service's supervision table.
 *
 * It lives next to the depot-scope resolver because it is the same call with the same
 * wiring — internal key, hard timeout, one URL — and because both answer questions about
 * the same table. `staff_supervision` became the single place a reporting line is written,
 * so a service that keeps its own `supervisorId` column would be reading a copy nobody
 * updates.
 *
 * NOT cached, unlike the scope resolver: the callers are occasional (a leave request
 * looking for its approver), and a stale answer would notify the wrong person.
 *
 * Throws only when configuration is missing or the call fails — callers decide whether
 * that is fatal. hr-service's notification path treats it as fail-soft, because a missing
 * notification must not reject somebody's leave request.
 */
export function httpSuperiorResolver(cfg: {
  depotServiceUrl?: string;
  internalKey?: string;
}): SuperiorResolver {
  return async (staffId) => {
    if (!cfg.depotServiceUrl || !cfg.internalKey) {
      throw new ServiceUnavailableException('Superior lookup is not configured.');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(
        `${cfg.depotServiceUrl}/api/v1/staff-hierarchy/internal/describe/${staffId}`,
        { headers: { 'x-internal-key': cfg.internalKey }, signal: controller.signal },
      );
      if (!res.ok) {
        throw new ServiceUnavailableException('Superior lookup failed.');
      }
      const body = (await res.json()) as { superiorId?: unknown };
      return typeof body.superiorId === 'string' ? body.superiorId : null;
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      throw new ServiceUnavailableException('Superior lookup failed.');
    } finally {
      clearTimeout(timeout);
    }
  };
}
