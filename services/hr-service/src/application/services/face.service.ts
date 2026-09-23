import { BadRequestException, ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { FaceEmbedding } from '../../../prisma/generated/client';
import { HrConfigService } from '../../config/hr-config.service';
import { bestMatch } from '../../domain/face-math';
import { storeFrame } from '../../infrastructure/storage/upload-frame';
import { hrStorageKey } from '../storage-key';
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
   *
   * `consented` is the HR admin recording, in person, that this employee agreed (HR-3).
   */
  async enroll(
    user: AuthenticatedUser,
    employeeId: string,
    images: Buffer[],
    sourcePhotoUrl: string | null,
    consented = false,
  ): Promise<FaceEmbedding> {
    const employee = await this.employees.getById(user, employeeId); // 404 + depot check (admin)
    await this.requireConsent(employee, consented, { by: user.sub, source: 'HR_DESK' });
    return this.enrollFor(employee, images, sourcePhotoUrl);
  }

  /** Self-enrollment (PWA): the caller enrolls their OWN linked employee record. */
  async enrollSelf(
    user: AuthenticatedUser,
    images: Buffer[],
    consented = false,
  ): Promise<FaceEmbedding> {
    const employee = await this.employees.getSelf(user); // resolves by authSubjectId
    await this.requireConsent(employee, consented, { by: user.sub, source: 'SELF' });
    return this.enrollFor(employee, images, null);
  }

  /**
   * HR-3 — a face may not be turned into a template without the employee's explicit consent.
   *
   * Enrolment used to take any frames the caller sent: nothing asked, nothing recorded,
   * nothing to show a regulator or the employee themselves. Biometrics are "data pribadi
   * spesifik" under UU 27/2022 — the only lawful basis here is consent, and consent that was
   * never recorded cannot be proven or withdrawn.
   *
   * A consent sent with THIS request is recorded before anything is enrolled, so a failure
   * mid-enrolment cannot leave a template with no consent behind it. An employee who already
   * consented is not asked again; one who never did is refused, and "never asked" is refused
   * exactly like "refused" — the absence of a record is not agreement.
   */
  private async requireConsent(
    employee: { id: string; faceConsentAt: Date | null },
    consented: boolean,
    stamp: { by: string; source: 'SELF' | 'HR_DESK' },
  ): Promise<void> {
    if (consented) {
      await this.employees.setFaceConsent(employee.id, stamp);
      return;
    }
    if (!employee.faceConsentAt) {
      throw new ForbiddenException(
        'Karyawan ini belum menyetujui pemakaian data wajah. Rekam persetujuannya dulu.',
      );
    }
  }

  /**
   * HR-3 — withdrawal. Consent that cannot be taken back is not consent, so this deletes the
   * templates (every one, retired ones included — a deactivated row is still a face), deletes
   * the stored frames behind them, and puts the employee back to "never asked". Face check-in
   * simply stops matching them; the PIN/manual path still works.
   */
  async withdrawConsent(employee: { id: string }): Promise<{ deleted: number }> {
    const stored = await this.repo.deleteForEmployee(employee.id);
    await this.employees.setFaceConsent(employee.id, null);
    for (const key of new Set(stored.map(hrStorageKey).filter((k): k is string => !!k))) {
      if (!this.storage) break;
      try {
        await this.storage.remove(key);
      } catch {
        // The template is already gone, which is what makes the face unusable. A frame left
        // in the bucket is caught by the HR-1 photo sweep rather than failing the withdrawal.
      }
    }
    return { deleted: stored.length };
  }

  /** The employee behind a withdrawal request: HR admin by id, or the caller's own record. */
  employeeFor(user: AuthenticatedUser, employeeId?: string): Promise<{ id: string }> {
    return employeeId ? this.employees.getById(user, employeeId) : this.employees.getSelf(user);
  }

  private async enrollFor(
    employee: { id: string; fullName: string },
    images: Buffer[],
    sourcePhotoUrl: string | null,
  ): Promise<FaceEmbedding> {
    if (images.length === 0) {
      throw new BadRequestException('Minimal satu frame wajah diperlukan');
    }

    const { vector, quality } = await this.verifier.enroll(images, {
      userId: employee.id,
      userName: employee.fullName,
    });

    // Local-embedding drivers (onnx/stub) dedup here; remote galleries (neo) return an empty
    // vector and dedup server-side, so skip the cosine check.
    if (vector.length > 0) {
      const others = await this.repo.listActiveVectorsExcept(employee.id);
      const { score } = bestMatch(
        vector,
        others.map((o) => o.vector),
      );
      if (score >= this.config.faceDuplicateThreshold) {
        throw new BadRequestException('Wajah ini sudah terdaftar untuk karyawan lain');
      }
    }

    // Persist the first source frame (best-effort) if the caller didn't pass a url.
    const storedUrl = sourcePhotoUrl ?? (await storeFrame(this.storage, images[0], 'hr/faces'));

    await this.repo.deactivateForEmployee(employee.id);
    return this.repo.create({
      employeeId: employee.id,
      vector,
      quality,
      sourcePhotoUrl: storedUrl,
    });
  }
}
