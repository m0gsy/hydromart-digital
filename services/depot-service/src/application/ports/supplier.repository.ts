import { Supplier } from '../../domain/supplier';

export interface CreateSupplierData {
  depotId: string;
  name: string;
  code: string;
  contactPhone: string | null;
  categories: string[];
  onTimeRate: number | null;
}

export interface SupplierRepository {
  create(data: CreateSupplierData): Promise<Supplier>;
  /** A depot's suppliers, newest first. */
  listForDepot(depotId: string): Promise<Supplier[]>;
  findById(id: string): Promise<Supplier | null>;
  findByCode(depotId: string, code: string): Promise<Supplier | null>;
}
