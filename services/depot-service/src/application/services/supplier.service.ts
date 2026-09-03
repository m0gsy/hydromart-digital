import { Inject, Injectable } from '@nestjs/common';

import { Supplier } from '../../domain/supplier';
import {
  DepotNotFoundError,
  DuplicateSupplierCodeError,
  SupplierInUseError,
  SupplierNotFoundError,
} from '../../domain/errors';
import { DepotRepository } from '../ports/depot.repository';
import { SupplierRepository } from '../ports/supplier.repository';
import { DEPOT_TOKENS } from '../tokens';

/** Every field a depot may correct after the fact. `depotId` is not one of them. */
export interface UpdateSupplierInput {
  name?: string;
  code?: string;
  contactPhone?: string | null;
  categories?: string[];
  onTimeRate?: number | null;
}

export interface CreateSupplierInput {
  depotId: string;
  name: string;
  code: string;
  contactPhone?: string | null;
  categories?: string[];
  onTimeRate?: number | null;
}

/** Depot supplier directory (design 11b): vendors that supply raw stock (galon/segel/air baku). */
@Injectable()
export class SupplierService {
  constructor(
    @Inject(DEPOT_TOKENS.SupplierRepository) private readonly suppliers: SupplierRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
  ) {}

  private async requireDepot(depotId: string): Promise<void> {
    if (!(await this.depots.exists(depotId))) {
      throw new DepotNotFoundError();
    }
  }

  async create(input: CreateSupplierInput): Promise<Supplier> {
    await this.requireDepot(input.depotId);
    if (await this.suppliers.findByCode(input.depotId, input.code)) {
      throw new DuplicateSupplierCodeError();
    }
    return this.suppliers.create({
      depotId: input.depotId,
      name: input.name,
      code: input.code,
      contactPhone: input.contactPhone ?? null,
      categories: input.categories ?? [],
      onTimeRate: input.onTimeRate ?? null,
    });
  }

  async list(depotId: string): Promise<Supplier[]> {
    await this.requireDepot(depotId);
    return this.suppliers.listForDepot(depotId);
  }

  async get(id: string): Promise<Supplier> {
    const found = await this.suppliers.findById(id);
    if (!found) throw new SupplierNotFoundError();
    return found;
  }

  /**
   * CA-2-64: a supplier could be created and then never touched again.
   *
   * Create, list, get — that was the whole directory. A phone number typed wrong, a name
   * spelled wrong, a vendor that changed hands: all permanent, and the only workaround was
   * a second row for the same supplier, which then split its purchase history in two.
   *
   * `depotId` is deliberately not editable. Moving a supplier between depots would move
   * its purchase orders' scope with it, and that is a transfer, not an edit.
   */
  async update(id: string, input: UpdateSupplierInput): Promise<Supplier> {
    const supplier = await this.get(id);
    if (input.code !== undefined && input.code !== supplier.code) {
      const clash = await this.suppliers.findByCode(supplier.depotId, input.code);
      if (clash && clash.id !== id) throw new DuplicateSupplierCodeError();
    }
    return this.suppliers.update(id, input);
  }

  /**
   * Remove a supplier nothing points at.
   *
   * A PO snapshots `supplierName`, so its own history reads fine either way — but its
   * `supplierId` would dangle, and `create` refuses a PO whose supplier is missing. So a
   * vendor with orders against it can be corrected, never deleted; one added by mistake,
   * before any order, goes away completely.
   */
  async remove(id: string): Promise<void> {
    const supplier = await this.get(id);
    const orders = await this.suppliers.countPurchaseOrders(supplier.id);
    if (orders > 0) throw new SupplierInUseError(orders);
    await this.suppliers.remove(id);
  }
}
