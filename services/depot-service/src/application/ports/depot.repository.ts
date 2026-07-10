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
  operatingHours: OperatingHours;
  holidays: Holiday[];
}

export type UpdateDepotData = Partial<CreateDepotData & { active: boolean }>;

export interface DepotRepository {
  search(query: DepotQuery): Promise<{ items: DepotRecord[]; total: number }>;
  findById(id: string, activeOnly: boolean): Promise<DepotRecord | null>;
  findByCode(code: string): Promise<DepotRecord | null>;
  /** All depots owned by an owner (active and inactive — an owner manages their own). */
  findByOwner(ownerId: string): Promise<DepotRecord[]>;
  create(data: CreateDepotData): Promise<DepotRecord>;
  update(id: string, patch: UpdateDepotData): Promise<DepotRecord>;
}
