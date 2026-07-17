import { BroadcastLevel } from '../../domain/broadcast-level';

export interface BroadcastRecord {
  id: string;
  depotId: string;
  title: string;
  body: string;
  level: BroadcastLevel;
  createdBy: string;
  createdAt: Date;
}

/** A broadcast plus the current courier's read receipt (null when unread). */
export interface BroadcastForCourier extends BroadcastRecord {
  readAt: Date | null;
}

export interface CreateBroadcastData {
  depotId: string;
  title: string;
  body: string;
  level: BroadcastLevel;
  createdBy: string;
}

export interface BroadcastRepository {
  create(data: CreateBroadcastData): Promise<BroadcastRecord>;
  findById(id: string): Promise<BroadcastRecord | null>;
  /** Depot broadcasts newest first, each annotated with `readAt` for the given courier. */
  listForCourier(depotId: string, courierId: string, limit: number): Promise<BroadcastForCourier[]>;
  /** Idempotent read receipt — upsert on (broadcastId, courierId). */
  markRead(broadcastId: string, courierId: string, readAt: Date): Promise<void>;
}
