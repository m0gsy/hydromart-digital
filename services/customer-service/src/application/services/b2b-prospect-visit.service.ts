import { Inject, Injectable, Logger } from '@nestjs/common';

import { AuthenticatedUser, assertDepotAccess, haversineMeters, isApproximateFix } from '@hydromart/platform';

import { CustomerConfigService } from '../../config/customer-config.service';
import { B2bProspectStatus } from '../../domain/b2b-prospect';
import { ProspectInvalidError, ProspectStaleError, ProspectTransitionError } from '../../domain/errors';
import { B2bProspectRepository, NewVisit, VisitRecord } from '../ports/b2b-prospect.repository';
import { CUSTOMER_TOKENS } from '../tokens';
import { auditProspect } from './b2b-prospect-audit';
import { B2bProspectService, ProspectDetail, toDetail } from './b2b-prospect.service';

/** Same wording as depot-service's depot visit (duplicated on purpose: no cross-service import). */
export const REFUSAL_APPROXIMATE =
  'Lokasi HP masih "Perkiraan" (bisa meleset sampai ±2 km), jadi kunjungan tidak bisa dicatat. ' +
  'Buka Setelan HP → Aplikasi → Hydromart → Izin → Lokasi, nyalakan "Gunakan lokasi akurat" (Tepat), ' +
  'nyalakan GPS, lalu coba lagi.';

const VISITABLE: readonly B2bProspectStatus[] = ['NEW', 'CONTACTED', 'VISITED', 'INTERESTED'];

/**
 * A salesperson's GPS check-in at a prospect (the same proof rules as a depot visit, a wider radius:
 * open-data pins are rough). A check-in is salesperson activity: it moves the retention clock and a
 * NEW or CONTACTED prospect to VISITED.
 */
@Injectable()
export class B2bProspectVisitService {
  private readonly logger = new Logger(B2bProspectVisitService.name);

  constructor(
    @Inject(CUSTOMER_TOKENS.B2bProspectRepository) private readonly repo: B2bProspectRepository,
    private readonly prospects: B2bProspectService,
    private readonly config: CustomerConfigService,
  ) {}

  async visit(
    user: AuthenticatedUser,
    id: string,
    input: Pick<NewVisit, 'latitude' | 'longitude' | 'accuracyM' | 'outcome'> & { note?: string },
  ): Promise<{ prospect: ProspectDetail; visit: VisitRecord }> {
    const { row } = await this.prospects.loadReachable(user, id);
    // The reach rule above already fenced the depot; asserting it on the row we act on keeps the by-id depot gate honest.
    assertDepotAccess(user, row.ownerDepotId);
    if (!VISITABLE.includes(row.status)) {
      throw new ProspectTransitionError('Prospek ini sudah selesai atau ditolak: tidak bisa dikunjungi');
    }
    if (!Number.isFinite(input.accuracyM) || input.accuracyM < 0) {
      throw new ProspectInvalidError('Akurasi lokasi tidak terbaca: nyalakan GPS lalu coba lagi');
    }
    const radius = this.config.prospectVisitRadiusM;
    const distance = haversineMeters(row.latitude, row.longitude, input.latitude, input.longitude);
    const distanceM = Math.round(distance);
    const approximate = isApproximateFix(input.latitude, input.longitude, input.accuracyM);
    // A fix that cannot prove presence is refused even when it lands inside: an approximate one, or one
    // whose own accuracy is wider than the radius.
    const tooLoose = approximate || input.accuracyM > radius;
    // `!(<=)`, not `>`: a NaN distance must refuse, never pass. Exactly at the radius is accepted.
    const outside = !(distance <= radius);
    if (tooLoose || outside) {
      // What is asked about afterwards; never the coordinates themselves.
      this.logger.warn(
        `Prospect visit refused: visitor ${user.sub}, prospect ${id}, ${distanceM} m, radius ${radius} m, ` +
          `accuracy ${input.accuracyM} m, approximate ${approximate}, outside ${outside}`,
      );
      throw new ProspectInvalidError(
        tooLoose
          ? REFUSAL_APPROXIMATE
          : `Di luar area usaha (${distanceM} m dari titik, batas ${radius} m). ` +
              'Kunjungan harus dicatat di lokasi. Kalau sudah di sana, lokasi HP belum akurat: ' +
              'di izin lokasi aplikasi pilih "Tepat" (bukan "Perkiraan"), nyalakan GPS, tunggu sebentar, lalu coba lagi.',
      );
    }
    const to: B2bProspectStatus = row.status === 'NEW' || row.status === 'CONTACTED' ? 'VISITED' : row.status;
    const made = await this.repo.recordVisit(
      id,
      row.status,
      to,
      {
        visitorId: user.sub,
        latitude: input.latitude,
        longitude: input.longitude,
        accuracyM: input.accuracyM,
        distanceM,
        outcome: input.outcome,
        note: input.note?.trim() || null,
      },
      new Date(),
    );
    // Moved on by somebody else, or taken by the retention sweep, since it was read.
    if (!made) throw new ProspectStaleError();
    await auditProspect(this.config, this.logger, {
      action: 'b2b.prospect.visit',
      actorId: user.sub,
      target: `b2b-prospect:${id}`,
      metadata: { prospectId: id, outcome: input.outcome, distanceM, from: row.status, to },
    });
    return { prospect: toDetail(made.prospect), visit: made.visit };
  }
}
