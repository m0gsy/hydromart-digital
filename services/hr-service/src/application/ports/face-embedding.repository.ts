import { FaceEmbedding } from '../../../prisma/generated/client';

export const FACE_EMBEDDING_REPOSITORY = Symbol('FACE_EMBEDDING_REPOSITORY');

/** An enrolled vector paired with its owner, for cross-employee duplicate detection. */
export interface OwnedVector {
  employeeId: string;
  vector: number[];
}

export interface FaceEmbeddingRepository {
  create(data: {
    employeeId: string;
    vector: number[];
    quality: number;
    sourcePhotoUrl: string | null;
  }): Promise<FaceEmbedding>;
  /** Active enrolled vectors for one employee (the verify set). */
  listActiveByEmployee(employeeId: string): Promise<FaceEmbedding[]>;
  /** How many active templates one employee has — a yes/no read that decrypts nothing. */
  countActiveByEmployee(employeeId: string): Promise<number>;
  /**
   * Face plan backfill: active rows with no local template yet and a stored source photo, of
   * ACTIVE employees who consented. Oldest first, at most `limit`.
   */
  listActiveWithoutLocalTemplate(
    limit: number,
    exclude?: string[],
  ): Promise<{ id: string; employeeId: string; sourcePhotoUrl: string | null }[]>;
  /**
   * Store a local template on a row that is STILL active, of an employee still ACTIVE and
   * consenting (a withdrawn face, or a leaver, stays without one).
   */
  setVectorIfActive(id: string, vector: number[]): Promise<boolean>;
  /** Active vectors of every OTHER employee (dup-check on enroll). */
  listActiveVectorsExcept(employeeId: string): Promise<OwnedVector[]>;
  /** Retire an employee's current embeddings (re-enroll replaces). */
  deactivateForEmployee(employeeId: string): Promise<void>;
  /**
   * HR-3: delete every template this employee has, active or retired, and hand back the
   * source-photo values so the caller can delete the objects too. Withdrawal of consent has
   * to leave nothing behind — a deactivated row is still a face.
   */
  deleteForEmployee(employeeId: string): Promise<string[]>;
}
