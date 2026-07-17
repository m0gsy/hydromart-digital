import { Inject, Injectable } from '@nestjs/common';

import { Supplier } from '../../domain/supplier';
import { DepotNotFoundError, DuplicateSupplierCodeError, SupplierNotFoundError } from '../../domain/errors';
import { DepotRepository } from '../ports/depot.repository';
import { SupplierRepository } from '../ports/supplier.repository';
import { DEPOT_TOKENS } from '../tokens';

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
    if (!(await this.depots.findById(depotId, false))) {
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
}
