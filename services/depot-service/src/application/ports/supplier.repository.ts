import { Supplier } from '../../domain/supplier';

export interface CreateSupplierData {
  depotId: string;
  name: string;
  code: string;
  contactPhone: string | null;
  categories: string[];
  onTimeRate: number | null;
}

/** CA-2-64: every editable field. Absent = unchanged; the depot is never editable. */
export interface UpdateSupplierData {
  name?: string;
  code?: string;
  contactPhone?: string | null;
  categories?: string[];
  onTimeRate?: number | null;
}

export interface SupplierRepository {
  create(data: CreateSupplierData): Promise<Supplier>;
  update(id: string, data: UpdateSupplierData): Promise<Supplier>;
  /** Hard delete. Only ever called for a supplier no purchase order references. */
  remove(id: string): Promise<void>;
  /** How many purchase orders name this supplier — 0 means deleting it loses nothing. */
  countPurchaseOrders(supplierId: string): Promise<number>;
  /** A depot's suppliers, newest first. */
  listForDepot(depotId: string): Promise<Supplier[]>;
  findById(id: string): Promise<Supplier | null>;
  findByCode(depotId: string, code: string): Promise<Supplier | null>;
}
