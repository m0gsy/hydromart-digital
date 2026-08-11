import { OwnershipType } from '../../domain/inventory';

export interface DayHours {
  open: string;
  close: string;
}
export type OperatingHours = Partial<
  Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', DayHours>
>;
export interface Holiday {
  date: string;
  label?: string;
}

export interface DepotRecord {
  id: string;
  code: string;
  name: string;
  ownershipType: OwnershipType;
  address: string;
  city: string;
  province: string;
  lat: number;
  lng: number;
  serviceRadiusKm: number;
  deliveryFee: number;
  minOrderAmount: number | null;
  ownerId: string | null;
  /** Assistant supervisor (auth account id) overseeing this depot; null = unassigned. */
  assistantSupervisorId: string | null;
  /** The depot's own WhatsApp number for operational messages; null = use the ops number. */
  contactPhone: string | null;
  paymentBankName: string | null;
  paymentBankAccountNumber: string | null;
  paymentBankAccountHolder: string | null;
  paymentQrisImageUrl: string | null;
  operatingHours: OperatingHours;
  holidays: Holiday[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DepotQuery {
  page: number;
  limit: number;
  ownershipType?: OwnershipType;
  search?: string;
  /** When true, only active depots are returned (public browse). */
  activeOnly: boolean;
}

export interface CreateDepotData {
  code: string;
  name: string;
  ownershipType: OwnershipType;
  address: string;
  city: string;
  province: string;
  lat: number;
  lng: number;
  serviceRadiusKm: number;
  deliveryFee: number;
  minOrderAmount: number | null;
  ownerId: string | null;
  assistantSupervisorId?: string | null;
  contactPhone?: string | null;
  paymentBankName?: string | null;
  paymentBankAccountNumber?: string | null;
  paymentBankAccountHolder?: string | null;
  paymentQrisImageUrl?: string | null;
  operatingHours: OperatingHours;
  holidays: Holiday[];
}

export type UpdateDepotData = Partial<CreateDepotData & { active: boolean }>;

export interface DepotRepository {
  search(query: DepotQuery): Promise<{ items: DepotRecord[]; total: number }>;
  findById(id: string, activeOnly: boolean): Promise<DepotRecord | null>;
  /**
   * Does this depot exist at all? Asked by the `requireDepot` guard at the top of nearly
   * every depot-scoped call — 47 call sites (audit S-19) — which used to read the whole
   * row and throw it away. A depot is never deleted, so a positive answer is remembered
   * for the life of the process; a negative one always goes to the database, which is what
   * lets a depot created a second ago be found.
   */
  exists(id: string): Promise<boolean>;
  findByCode(code: string): Promise<DepotRecord | null>;
  /** All depots owned by an owner (active and inactive — an owner manages their own). */
  findByOwner(ownerId: string): Promise<DepotRecord[]>;
  create(data: CreateDepotData): Promise<DepotRecord>;
  update(id: string, patch: UpdateDepotData): Promise<DepotRecord>;
}
