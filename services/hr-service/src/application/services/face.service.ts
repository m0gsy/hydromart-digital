import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { FaceEmbedding } from '../../../prisma/generated/client';
import { HrConfigService } from '../../config/hr-config.service';
import { bestMatch } from '../../domain/face-math';
import { storeFrame } from '../../infrastructure/storage/upload-frame';
import { hrStorageKey } from '../storage-key';
import {
  FACE_VERIFIER,
  FaceEngineUnavailableError,
  FaceReplaceFailedError,
  FaceVerifier,
} from '../ports/face-verifier.port';
import {
  FACE_EMBEDDING_REPOSITORY,
  FaceEmbeddingRepository,
} from '../ports/face-embedding.repository';
import { STORAGE_PORT, StoragePort } from '../ports/storage.port';
import { EmployeeService } from './employee.service';

/**
 * What the employee reads when the engine cannot take an enrolment (owner, 2026-11-27). The engine's
 * own wording ("Face engine (NEO) gagal: enroll-face: ...") reached the app, and the next tap that
 * morning was "Tarik persetujuan & hapus data wajah", five times: it fixes nothing and leaves the
 * employee with no face on file. Served from here, so the installed app shows it without a release.
 */
export const ENGINE_DOWN_ENROLL_MESSAGE =
  'Sistem pengenal wajah sedang gangguan, bukan masalah wajah Anda. Absen tetap tercatat untuk ' +
  'diperiksa HR. Coba daftar wajah lagi nanti, dan jangan hapus data wajah Anda.';

@Injectable()
export class FaceService {
  private readonly logger = new Logger(FaceService.name);

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
  async withdrawConsent(
    employee: { id: string; fullName?: string },
  ): Promise<{ deleted: number }> {
    const stored = await this.repo.deleteForEmployee(employee.id);
    await this.employees.setFaceConsent(employee.id, null);
    await this.removeRemote(employee);
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

  /**
   * Take the face out of the engine's own gallery as well. Until now a withdrawal cleared only our
   * table, so the biometric stayed with the third party after the person took their consent back,
   * and re-enrolling later collided with it. Best-effort on purpose: the local template is already
   * gone, which is what makes the face unusable here, and a withdrawal must not fail because a
   * provider is down — but it is logged at error level, never silent, so it can be swept.
   */
  private async removeRemote(employee: { id: string; fullName?: string }): Promise<boolean> {
    if (!this.verifier.remove) return true;
    try {
      await this.verifier.remove({ userId: employee.id, userName: employee.fullName ?? '' });
      return true;
    } catch (err) {
      this.logger.error(`face withdrawal: gallery delete failed for ${employee.id}: ${String(err)}`);
      return false;
    }
  }

  /**
   * Flow 5d: has the caller a face to be matched against? The courier's one-tap check-in asks
   * before it asks for a selfie — a punch without a template is refused only after the photo
   * was taken and the shift had started. Refused the way the punch refuses (a record that is
   * not ACTIVE), so the app never offers a camera for a punch that cannot land; and counted,
   * not read — no biometric template is decrypted to answer a yes or no.
   */
  async selfEnrolled(user: AuthenticatedUser): Promise<{ enrolled: boolean }> {
    const employee = await this.employees.getSelf(user);
    if (employee.status !== 'ACTIVE') throw new ForbiddenException('Karyawan tidak aktif');
    return { enrolled: (await this.repo.countActiveByEmployee(employee.id)) > 0 };
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

    let enrolled: { vector: number[]; quality: number };
    try {
      enrolled = await this.verifier.enroll(images, {
        userId: employee.id,
        userName: employee.fullName,
      });
    } catch (err) {
      if (err instanceof FaceReplaceFailedError) {
        // The engine dropped the old face and did not take the new one. The enrolment HR holds
        // would now fail every punch with a face that is gone: retired, so the app asks again.
        await this.repo
          .deactivateForEmployee(employee.id)
          .catch((e: unknown) => this.logger.warn(`Enrolment of ${employee.id} not retired: ${String(e)}`));
      }
      const refusal = err instanceof FaceReplaceFailedError ? err.refusal : err;
      if (!(refusal instanceof FaceEngineUnavailableError)) throw refusal;
      this.logger.warn(`Enrolment of ${employee.id} refused, face engine down: ${refusal.message}`);
      throw new FaceEngineUnavailableError(ENGINE_DOWN_ENROLL_MESSAGE);
    }
    const { vector, quality } = enrolled;

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
