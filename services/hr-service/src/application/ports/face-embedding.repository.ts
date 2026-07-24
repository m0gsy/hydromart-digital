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
  /** Active vectors of every OTHER employee (dup-check on enroll). */
  listActiveVectorsExcept(employeeId: string): Promise<OwnedVector[]>;
  /** Retire an employee's current embeddings (re-enroll replaces). */
  deactivateForEmployee(employeeId: string): Promise<void>;
}
