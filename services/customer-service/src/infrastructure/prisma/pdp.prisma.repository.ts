import { Injectable } from '@nestjs/common';

import { PdpRepository } from '../../application/ports/pdp.repository';
import { PrismaService } from './prisma.service';

/** Tombstone written over a deleted person's name. Not blank: a blank recipient name
 * reads as a data bug to whoever looks at an old delivery record. */
const REDACTED_NAME = 'Pengguna dihapus';
const REDACTED_PHONE = '-';

@Injectable()
export class PdpPrismaRepository implements PdpRepository {
  constructor(private readonly prisma: PrismaService) {}

  async exportFor(customerId: string): Promise<Record<string, unknown>> {
    const [profile, addresses, paymentMethods, favorites, notifications, reseller] =
      await Promise.all([
        this.prisma.customerProfile.findUnique({ where: { customerId } }),
        this.prisma.address.findMany({ where: { customerId } }),
        this.prisma.savedPaymentMethod.findMany({ where: { customerId } }),
        this.prisma.favorite.findMany({ where: { customerId } }),
        this.prisma.notificationPreference.findUnique({ where: { customerId } }),
        this.prisma.resellerProfile.findFirst({ where: { customerId } }),
      ]);
    return { profile, addresses, paymentMethods, favorites, notifications, reseller };
  }

  /**
   * Addresses are overwritten rather than deleted: an order that was delivered to a
   * street still needs a street, and item 12 keeps the order itself for ten years. What
   * goes is everything that names a person — recipient name, phone, free-text notes.
   * Favourites and payment labels are not financial records and are simply removed.
   *
   * `reseller_profiles` was the miss `docs/AUDIT_L3.md` §4.2 named most precisely: one
   * file, two methods, one table. `exportFor` above reads it AS PERSONAL DATA — it is in
   * the export payload — and this method never touched it. It carries the agen's
   * registration photo (a KTP or a shopfront), a free-text note, and their home depot.
   *
   * Deactivated and scrubbed rather than deleted: the row is referenced by reseller pricing
   * at checkout and by the per-depot achievement evaluation, so removing it would strand
   * those. `active: false` stops it being used; the photo and the note are the person.
   */
  async anonymise(customerId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.address.updateMany({
        where: { customerId },
        data: {
          recipientName: REDACTED_NAME,
          phone: REDACTED_PHONE,
          notes: null,
          // CUS-05: a street, a postcode and a pin on a map are the person. The city stays so
          // the row still joins as a primary address; order-service keeps its own snapshot of
          // where an order went, which is the ten-year record.
          label: REDACTED_PHONE,
          addressLine: REDACTED_PHONE,
          postalCode: null,
          latitude: null,
          longitude: null,
        },
      }),
      this.prisma.savedPaymentMethod.deleteMany({ where: { customerId } }),
      this.prisma.favorite.deleteMany({ where: { customerId } }),
      this.prisma.notificationPreference.deleteMany({ where: { customerId } }),
      // Birthdate is PII and drives the birthday promo; both must stop.
      this.prisma.customerProfile.updateMany({
        where: { customerId },
        data: {
          birthdate: null,
          lastBirthdayRewardYear: null,
          // CUS-05: out of every depot's directory, and the marker the audience queries read.
          // Deleting the opt-out row above reads as "never asked", i.e. INCLUDED; this is what
          // keeps an erased person out of the next broadcast.
          favoriteDepotId: null,
          anonymisedAt: new Date(),
        },
      }),
      this.prisma.resellerProfile.updateMany({
        where: { customerId },
        data: { photoUrl: null, note: null, active: false },
      }),
    ]);
  }
}
