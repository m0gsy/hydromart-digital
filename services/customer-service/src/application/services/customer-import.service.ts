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

  /**
   * §I: the buyer at a depot counter, resolved (or pre-registered) by phone number.
   *
   * The POS used to do this from the BROWSER by posting a one-row Excel import and then
   * sending the id to order-service, so any other client posting `/orders/walk-in` with a
   * phone and no customerId booked the sale against the anonymous sentinel and created
   * nobody. The orchestration belongs on the server, and this is the server half.
   *
   * Deliberately the same rules the import already follows: identity comes from
   * auth-service, and an account that is already ACTIVE belongs to that person — their
   * favourite depot is left alone, so the last depot to sell them water cannot claim them.
   */
  async resolveByPhone(
    phone: string,
    fullName: string | null,
    depotId?: string,
  ): Promise<{ customerId: string; status: 'created' | 'pending' | 'active' }> {
    /**
     * C9: a name the cashier did not type is not a name.
     *
     * The counter used to fall back to the phone number, so an account was created with
     * `fullName` set to "081234567890" — a string that then appeared as a person's name
     * everywhere a name is shown, on an account nobody verified and nobody consented to.
     * `fullName` is optional here, so the honest answer is to send nothing and let each
     * screen render its own "unnamed" state.
     *
     * Measured on production 2026-08-20 before changing it: 0 of 21 customers currently
     * carry a phone-shaped name, so this closes the path before it produced its first row
     * rather than after.
     */
    const named = fullName?.trim() || undefined;
    const { customerId, status } = await this.identity.preRegisterCustomer(phone, named);
    if (status !== 'active' && depotId) {
      await this.profiles.upsertFavoriteDepot(customerId, depotId);
    }
    return { customerId, status };
  }

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

      // One statement, not three (audit S-16): rows are imported one at a time so each can
      // report its own failure, which makes every round-trip per row a round-trip per row
      // of the file.
      await this.profiles.upsertFavoriteDepot(customerId, depotId);

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
