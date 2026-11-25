import { MaintenanceItem } from '../../domain/maintenance';

export interface CreateMaintenanceData {
  depotId: string;
  name: string;
  category: string;
  intervalDays: number | null;
  intervalM3: number | null;
  lastServicedAt: Date | null;
  nextDueAt: Date | null;
  note: string | null;
}

/** Partial patch: service-completion fields. */
export interface UpdateMaintenanceData {
  lastServicedAt?: Date | null;
  nextDueAt?: Date | null;
}

export interface MaintenanceRepository {
  create(data: CreateMaintenanceData): Promise<MaintenanceItem>;
  /** A depot's maintenance items, ordered by next-due date ascending. */
  listForDepot(depotId: string): Promise<MaintenanceItem[]>;
  /** Every item of every ACTIVE depot, with the depot's name (the n8n due sweep reads these). */
  listAllActive(): Promise<Array<MaintenanceItem & { depotName: string }>>;
  findById(id: string): Promise<MaintenanceItem | null>;
  update(id: string, data: UpdateMaintenanceData): Promise<MaintenanceItem>;
}
