import { MaintenanceItem } from '../../domain/maintenance';

export interface CreateMaintenanceData {
  depotId: string;
  name: string;
  category: string;
  intervalDays: number;
  lastServicedAt: Date | null;
  nextDueAt: Date;
  note: string | null;
}

/** Partial patch: service-completion fields. */
export interface UpdateMaintenanceData {
  lastServicedAt?: Date | null;
  nextDueAt?: Date;
}

export interface MaintenanceRepository {
  create(data: CreateMaintenanceData): Promise<MaintenanceItem>;
  /** A depot's maintenance items, ordered by next-due date ascending. */
  listForDepot(depotId: string): Promise<MaintenanceItem[]>;
  findById(id: string): Promise<MaintenanceItem | null>;
  update(id: string, data: UpdateMaintenanceData): Promise<MaintenanceItem>;
}
