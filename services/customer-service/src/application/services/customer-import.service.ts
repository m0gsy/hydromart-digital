import { Inject, Injectable } from '@nestjs/common';

import { AuthenticatedUser, ImportSummary, assertDepotAccess, runImport } from '@hydromart/platform';

import { ResellerExistsError } from '../../domain/errors';
import { IdentityPort } from '../ports/identity.port';
import { ProfileRepository } from '../ports/profile.repository';
import { CUSTOMER_TOKENS } from '../tokens';
import { AddressService } from './address.service';
import { ResellerService } from './reseller.service';

export interface ImportCustomerRow {
  fullName: string;
  phone: string;
  /** Optional address; when addressLine is present, city and province are required. */
  addressLine?: string;
  city?: string;
  province?: string;
  /** Free-text landmark ("patokan") that reaches the courier via the order note. */
  landmark?: string;
}

export interface ImportResellerRow {
  fullName: string;
  phone: string;
  discountPct: number;
  monthlyTargetQty: number;
  joinDate: string;
  note?: string;
}

/**
 * Bulk import for depot staff: the customers and resellers a depot already serves.
 *
 * Identity always comes from auth-service, never from a local row — an imported
 * customer gets a PENDING account they claim themselves via the normal OTP signup with
 * the number the depot registered. The depot link lives in `favoriteDepotId`, not in
 * auth's `assignedDepotId`, which is staff depot scope and has no business in a
 * customer's token.
 */
@Injectable()
export class CustomerImportService {
  constructor(
    @Inject(CUSTOMER_TOKENS.IdentityPort) private readonly identity: IdentityPort,
    @Inject(CUSTOMER_TOKENS.ProfileRepository) private readonly profiles: ProfileRepository,
    private readonly addresses: AddressService,
    private readonly resellers: ResellerService,
  ) {}

  async importCustomers(
    user: AuthenticatedUser,
    depotId: string,
    rows: readonly ImportCustomerRow[],
  ): Promise<ImportSummary> {
    // A depot-locked importer may only fill their own depot's directory.
    assertDepotAccess(user, depotId);

    return runImport(rows, async (row) => {
      const { customerId, status } = await this.identity.preRegisterCustomer(
        row.phone,
        row.fullName,
      );
      // An already-verified account belongs to that person, not to the importing depot:
      // don't repoint their home depot or add addresses to their book.
      if (status === 'active') {
        return { status: 'skipped', id: customerId, message: 'Nomor sudah punya akun aktif' };
      }

      if (!(await this.profiles.exists(customerId))) {
        await this.profiles.create(customerId);
      }
      await this.profiles.updateFavoriteDepot(customerId, depotId);

      if (row.addressLine) {
        if (!row.city || !row.province) {
          throw new Error('kota dan provinsi wajib diisi bila alamat ditulis');
        }
        await this.addresses.create(customerId, {
          label: 'Rumah',
          recipientName: row.fullName,
          phone: row.phone,
          addressLine: row.addressLine,
          city: row.city,
          province: row.province,
          notes: row.landmark,
        });
      }

      return { status: 'created', id: customerId };
    });
  }

  async importResellers(
    user: AuthenticatedUser,
    homeDepotId: string,
    rows: readonly ImportResellerRow[],
  ): Promise<ImportSummary> {
    assertDepotAccess(user, homeDepotId);

    return runImport(
      rows,
      async (row) => {
        // A reseller hangs off a customer identity, so resolve (or pre-register) the
        // phone first — same claim-it-yourself rule as a plain customer import.
        const { customerId } = await this.identity.preRegisterCustomer(row.phone, row.fullName);
        const reseller = await this.resellers.register(user, {
          customerId,
          homeDepotId,
          monthlyTargetQty: row.monthlyTargetQty,
          discountPct: row.discountPct,
          joinDate: new Date(row.joinDate),
          note: row.note,
        });
        return { status: 'created', id: reseller.customerId };
      },
      (err) => err instanceof ResellerExistsError,
    );
  }
}
