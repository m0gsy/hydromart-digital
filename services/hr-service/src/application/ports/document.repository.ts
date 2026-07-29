import { EmployeeDocument, EmployeeDocumentType } from '../../../prisma/generated/client';

export const DOCUMENT_REPOSITORY = Symbol('DOCUMENT_REPOSITORY');

export interface DocumentWrite {
  employeeId: string;
  type: EmployeeDocumentType;
  fileUrl: string;
  fileKey: string;
  mimeType: string;
  sizeBytes: number;
  version: number;
  uploadedBy: string | null;
  expiresAt: Date | null;
}

/** Just enough of a row to purge it: the key is what the storage delete needs. */
export interface PurgeableDocument {
  id: string;
  fileKey: string;
}

export interface DocumentRepository {
  create(data: DocumentWrite): Promise<EmployeeDocument>;
  findById(id: string): Promise<EmployeeDocument | null>;
  listByEmployee(employeeId: string): Promise<EmployeeDocument[]>;
  /** The newest not-yet-superseded row of a type, i.e. what "the KTP on file" means today. */
  findCurrent(employeeId: string, type: EmployeeDocumentType): Promise<EmployeeDocument | null>;
  /** Point an old row at its replacement. */
  markSuperseded(id: string, supersededById: string): Promise<void>;
  /**
   * Documents belonging to employees who left before `cutoff`. Returns keys so the caller can
   * delete the objects too — a row without its file is not an erasure.
   */
  listPurgeable(cutoff: Date): Promise<PurgeableDocument[]>;
  deleteMany(ids: string[]): Promise<number>;
}
