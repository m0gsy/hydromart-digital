import { SegmentFilter } from './customer-directory.port';

/** A named audience definition (design 21d). */
export interface SavedSegmentRecord {
  id: string;
  name: string;
  conditions: SegmentFilter;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SavedSegmentRepository {
  list(limit: number): Promise<SavedSegmentRecord[]>;
  findById(id: string): Promise<SavedSegmentRecord | null>;
  /**
   * Upsert by NAME. Saving "Pelanggan berisiko" twice is one person refining one audience,
   * not two audiences that happen to share a label — and a duplicate name is how two
   * people end up messaging different lists while believing they picked the same one.
   */
  upsertByName(data: {
    name: string;
    conditions: SegmentFilter;
    createdBy: string;
  }): Promise<SavedSegmentRecord>;
  remove(id: string): Promise<boolean>;
}
