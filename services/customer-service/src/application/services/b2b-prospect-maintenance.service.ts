import { ForbiddenException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { AuthenticatedUser, depotScopeIds, servingDepot } from '@hydromart/platform';

import { CustomerConfigService } from '../../config/customer-config.service';
import { B2bProspectRepository } from '../ports/b2b-prospect.repository';
import { DepotProfilePort } from '../ports/depot-profile.port';
import { CUSTOMER_TOKENS } from '../tokens';
import { auditProspect } from './b2b-prospect-audit';

const BATCH = 500;

/**
 * The two housekeeping jobs: the 12-month retention purge (admin-service's nightly sweep) and the
 * monthly owner-depot recompute (a depot opened, closed or redrew its area).
 */
@Injectable()
export class B2bProspectMaintenanceService {
  private readonly logger = new Logger(B2bProspectMaintenanceService.name);

  constructor(
    @Inject(CUSTOMER_TOKENS.B2bProspectRepository) private readonly repo: B2bProspectRepository,
    @Inject(CUSTOMER_TOKENS.DepotProfilePort) private readonly depotProfile: DepotProfilePort,
    private readonly config: CustomerConfigService,
  ) {}

  /** Counts only in the log: nothing here names a business. */
  async purge(cutoff: Date): Promise<{ deleted: number; anonymised: number }> {
    const done = await this.repo.purge(cutoff);
    this.logger.log(`B2B prospect retention: ${done.deleted} deleted, ${done.anonymised} anonymised`);
    return done;
  }

  /**
   * Re-runs the owner-depot rule for rows the system placed (owner AUTO). HQ-set owners, converted
   * and do-not-contact rows are never touched. It aborts before changing anything when depot-service
   * does not answer (or answers with no depot): "no depot knows this pin" must never be read as
   * "every prospect is out of area". Not salesperson activity: no row's retention clock moves.
   */
  async recomputeOwners(user: AuthenticatedUser): Promise<{ checked: number; changed: number; nowOnMap: number }> {
    // A network power (Import is Marketing / HQ): a depot-scoped holder of a custom role must not reshuffle the network.
    if (depotScopeIds(user) !== undefined) {
      throw new ForbiddenException('Hitung ulang depot pemilik hanya untuk peran tingkat jaringan');
    }
    const depots = await this.depotProfile.listActive();
    if (!depots || depots.length === 0) {
      throw new ServiceUnavailableException('depot-service tidak menjawab: tidak ada yang diubah');
    }
    let checked = 0;
    let changed = 0;
    let nowOnMap = 0;
    let after: string | null = null;
    for (;;) {
      const batch = await this.repo.autoOwnedAfter(after, BATCH);
      for (const row of batch) {
        const next = servingDepot({ lat: row.latitude, lng: row.longitude }, depots)?.id ?? null;
        if (next === row.ownerDepotId) continue;
        if (await this.repo.moveOwner(row.id, row.ownerDepotId, next)) {
          changed += 1;
          if (next === null) nowOnMap += 1;
        }
      }
      checked += batch.length;
      if (batch.length < BATCH) break;
      after = batch[batch.length - 1]!.id;
    }
    await auditProspect(this.config, this.logger, {
      action: 'b2b.prospect.recompute-owners',
      actorId: user.sub,
      target: 'b2b-prospects:recompute',
      metadata: { checked, changed, nowOnMap },
    });
    return { checked, changed, nowOnMap };
  }
}
