import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { EmployeeDocument, EmployeeDocumentType } from '../../../prisma/generated/client';
import { DOCUMENT_REPOSITORY, DocumentRepository } from '../ports/document.repository';
import { STORAGE_PORT, StoragePort } from '../ports/storage.port';
import { EmployeeService } from './employee.service';

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

/** Scans and PDFs only — an employee file is not a place to park arbitrary binaries. */
export const ALLOWED_DOCUMENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export interface UploadedDocumentFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export interface UploadDocumentInput {
  employeeId: string;
  type: EmployeeDocumentType;
  expiresAt?: string;
}

/**
 * An employee's personal file. Replacing a document never overwrites one: the new upload is
 * a fresh row at version+1 and the previous row is stamped superseded, so "what did HR hold
 * in March" stays answerable. Storage keys are kept because the retention purge has to delete
 * the object, not just the pointer to it.
 */
@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly repo: DocumentRepository,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly employees: EmployeeService,
  ) {}

  async upload(
    user: AuthenticatedUser,
    input: UploadDocumentInput,
    file: UploadedDocumentFile | undefined,
  ): Promise<EmployeeDocument> {
    await this.employees.getById(user, input.employeeId); // 404 + depot check
    if (!file) throw new BadRequestException('File dokumen wajib diunggah');

    const ext = ALLOWED_DOCUMENT_TYPES[file.mimetype];
    if (!ext) {
      throw new BadRequestException('Tipe file tidak didukung (jpeg, png, webp, pdf)');
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      throw new PayloadTooLargeException('Ukuran file melebihi 5MB');
    }

    // Storage being down is an infrastructure fault, not a bad request: answer 503 (retryable)
    // and log which upload failed, rather than letting it escape as a bare 500.
    let stored: { url: string; key: string };
    try {
      stored = await this.storage.put({
        body: file.buffer,
        contentType: file.mimetype,
        ext,
        keyPrefix: 'hr/documents',
      });
    } catch (error) {
      this.logger.error(
        `Document upload failed for employee ${input.employeeId}: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'Penyimpanan dokumen sedang tidak tersedia. Coba lagi sebentar lagi.',
      );
    }
    if (!stored.url) {
      // The no-op adapter (STORAGE_DRIVER unset) returns an empty url. Recording a row that
      // points nowhere would look like a filed document that cannot be opened.
      throw new ServiceUnavailableException('Penyimpanan dokumen belum dikonfigurasi');
    }

    const previous = await this.repo.findCurrent(input.employeeId, input.type);
    const created = await this.repo.create({
      employeeId: input.employeeId,
      type: input.type,
      fileUrl: stored.url,
      fileKey: stored.key,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      version: (previous?.version ?? 0) + 1,
      uploadedBy: user.sub,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    });
    if (previous) await this.repo.markSuperseded(previous.id, created.id);
    return created;
  }

  async list(user: AuthenticatedUser, employeeId: string): Promise<EmployeeDocument[]> {
    await this.employees.getById(user, employeeId);
    return this.repo.listByEmployee(employeeId);
  }

  async get(user: AuthenticatedUser, id: string): Promise<EmployeeDocument> {
    const document = await this.repo.findById(id);
    if (!document) throw new NotFoundException('Dokumen tidak ditemukan');
    await this.employees.getById(user, document.employeeId); // depot check
    return document;
  }

  /**
   * Retention enforcement (UU 27/2022). Deletes the stored object first, then the row: if the
   * object delete fails we would rather keep a row that still points at the file than lose the
   * only key that can reach it. Storage failures are counted, not swallowed silently.
   */
  async purgeRetentionEligible(cutoff: Date): Promise<{ deleted: number; failed: number }> {
    const rows = await this.repo.listPurgeable(cutoff);
    const deletable: string[] = [];
    let failed = 0;
    for (const row of rows) {
      try {
        await this.storage.remove(row.fileKey);
        deletable.push(row.id);
      } catch (error) {
        failed++;
        this.logger.error(
          `Retention purge could not delete ${row.fileKey}: ${(error as Error).message}`,
        );
      }
    }
    const deleted = deletable.length > 0 ? await this.repo.deleteMany(deletable) : 0;
    return { deleted, failed };
  }
}
