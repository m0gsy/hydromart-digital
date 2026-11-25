import { SopInForce } from '../../domain/visit-template';

/**
 * hr-service owns SOPs; depot-service only asks which version of each is in force at a depot
 * today (GET /api/v1/sops/internal/in-force). `null` means "could not ask", never "no SOP":
 * the caller decides what an unavailable answer is worth (for a checklist, the item still shows).
 */
export interface SopLookupPort {
  inForce(depotId: string, sopIds: readonly string[]): Promise<SopInForce[] | null>;
}
