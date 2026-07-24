import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { FaceEmbedding } from '../../../prisma/generated/client';
import { HrConfigService } from '../../config/hr-config.service';
import { bestMatch } from '../../domain/face-math';
import { uploadFrame } from '../../infrastructure/storage/upload-frame';
import { FACE_VERIFIER, FaceVerifier } from '../ports/face-verifier.port';
import {
  FACE_EMBEDDING_REPOSITORY,
  FaceEmbeddingRepository,
} from '../ports/face-embedding.repository';
import { STORAGE_PORT, StoragePort } from '../ports/storage.port';
import { EmployeeService } from './employee.service';

@Injectable()
export class FaceService {
  constructor(
    @Inject(FACE_VERIFIER) private readonly verifier: FaceVerifier,
    @Inject(FACE_EMBEDDING_REPOSITORY) private readonly repo: FaceEmbeddingRepository,
    private readonly employees: EmployeeService,
    private readonly config: HrConfigService,
    @Optional() @Inject(STORAGE_PORT) private readonly storage?: StoragePort,
  ) {}

  /**
   * Enroll aligned frames for an employee. Rejects if the face already belongs to a
   * DIFFERENT employee (dup-check). Re-enrolling replaces the employee's current set.
   */
  async enroll(
    user: AuthenticatedUser,
    employeeId: string,
    images: Buffer[],
    sourcePhotoUrl: string | null,
  ): Promise<FaceEmbedding> {
    await this.employees.getById(user, employeeId); // 404 + depot check (admin)
    return this.enrollFor(employeeId, images, sourcePhotoUrl);
  }

  /** Self-enrollment (PWA): the caller enrolls their OWN linked employee record. */
  async enrollSelf(user: AuthenticatedUser, images: Buffer[]): Promise<FaceEmbedding> {
    const employee = await this.employees.getSelf(user); // resolves by authSubjectId
    return this.enrollFor(employee.id, images, null);
  }

  private async enrollFor(
    employeeId: string,
    images: Buffer[],
    sourcePhotoUrl: string | null,
  ): Promise<FaceEmbedding> {
    if (images.length === 0) {
      throw new BadRequestException('Minimal satu frame wajah diperlukan');
    }

    const { vector, quality } = await this.verifier.enroll(images);

    const others = await this.repo.listActiveVectorsExcept(employeeId);
    const { score } = bestMatch(
      vector,
      others.map((o) => o.vector),
    );
    if (score >= this.config.faceDuplicateThreshold) {
      throw new BadRequestException('Wajah ini sudah terdaftar untuk karyawan lain');
    }

    // Persist the first source frame (best-effort) if the caller didn't pass a url.
    const storedUrl = sourcePhotoUrl ?? (await uploadFrame(this.storage, images[0], 'hr/faces'));

    await this.repo.deactivateForEmployee(employeeId);
    return this.repo.create({ employeeId, vector, quality, sourcePhotoUrl: storedUrl });
  }
}
