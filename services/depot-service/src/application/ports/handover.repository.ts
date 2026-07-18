import { HandoverItem, ShiftHandover } from '../../domain/handover';

export interface CreateHandoverData {
  depotId: string;
  fromShift: string;
  toShift: string;
  fromStaff: string;
  toStaff: string;
  items: HandoverItem[];
  note: string | null;
  recordedBy: string;
}

export interface HandoverRepository {
  create(data: CreateHandoverData): Promise<ShiftHandover>;
  /** A depot's handovers, newest first. */
  listForDepot(depotId: string): Promise<ShiftHandover[]>;
  findById(id: string): Promise<ShiftHandover | null>;
  /** Stamp signedAt on an existing handover. */
  sign(id: string, signedAt: Date): Promise<ShiftHandover>;
}
