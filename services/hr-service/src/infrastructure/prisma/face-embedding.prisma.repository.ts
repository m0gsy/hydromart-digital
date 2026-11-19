import { Injectable } from '@nestjs/common';
import { FaceEmbedding } from '../../../prisma/generated/client';

import {
  FaceEmbeddingRepository,
  OwnedVector,
} from '../../application/ports/face-embedding.repository';
import { HrConfigService } from '../../config/hr-config.service';
import { alertServerError } from '@hydromart/platform';

import { decryptVector, encryptVector } from '../crypto/face-vector.cipher';
import { PrismaService } from './prisma.service';

/** Row as stored: `vectorEnc` on anything enrolled since B-19, `vector` on older rows. */
type StoredVector = { vector: number[]; vectorEnc: Uint8Array | null };

@Injectable()
export class FaceEmbeddingPrismaRepository implements FaceEmbeddingRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: HrConfigService,
  ) {}

  /** One message per process: a wrong key fails for every row, and ops need to hear it once. */
  private decryptAlerted = false;

  /**
   * The usable vector for a row, whichever form it was stored in.
   *
   * Face plan PR-2: a row that will not decrypt (a rotated or wrong HR_FACE_ENCRYPTION_KEY)
   * used to throw, and that turned every punch of every employee into a 500 — including NEO
   * punches, which never use the local template. On the punch path it reads as no template
   * ([]) now, which `bestMatch` skips, and ops get one alert. NOT on the enrolment path
   * (`failSafe` false): the duplicate-face check must fail closed, or a template nobody can
   * read lets one face enrol for a second employee.
   */
  private plain<T extends StoredVector>(row: T, failSafe = true): T {
    if (!row.vectorEnc) return row;
    if (!failSafe) {
      return { ...row, vector: decryptVector(row.vectorEnc, this.config.faceEncryptionKey) };
    }
    try {
      return { ...row, vector: decryptVector(row.vectorEnc, this.config.faceEncryptionKey) };
    } catch (e) {
      if (!this.decryptAlerted) {
        this.decryptAlerted = true;
        alertServerError({
          method: 'GET',
          path: '/api/v1/attendance (face template decrypt)',
          status: 500,
          exception: new Error(
            `A face template does not decrypt with HR_FACE_ENCRYPTION_KEY: ${(e as Error).message}`,
          ),
        });
      }
      return { ...row, vector: [] };
    }
  }

  create(data: {
    employeeId: string;
    vector: number[];
    quality: number;
    sourcePhotoUrl: string | null;
  }): Promise<FaceEmbedding> {
    const { vector, ...rest } = data;
    // Never write the template in the clear. `vector` stays an empty array for the column's
    // NOT NULL, and remote-gallery drivers (neo) hand us an empty vector to begin with.
    return this.prisma.faceEmbedding.create({
      data: {
        ...rest,
        vector: [],
        vectorEnc: vector.length > 0 ? encryptVector(vector, this.config.faceEncryptionKey) : null,
      },
    });
  }

  async listActiveByEmployee(employeeId: string): Promise<FaceEmbedding[]> {
    const rows = await this.prisma.faceEmbedding.findMany({ where: { employeeId, active: true } });
    return rows.map((r) => this.plain(r));
  }

  listActiveWithoutLocalTemplate(
    limit: number,
  ): Promise<{ id: string; employeeId: string; sourcePhotoUrl: string | null }[]> {
    return this.prisma.faceEmbedding.findMany({
      where: {
        active: true,
        vectorEnc: null,
        vector: { isEmpty: true },
        sourcePhotoUrl: { not: null },
        employee: { status: 'ACTIVE', faceConsentAt: { not: null } },
      },
      select: { id: true, employeeId: true, sourcePhotoUrl: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async setVectorIfActive(id: string, vector: number[]): Promise<boolean> {
    // updateMany, not update: the `active` filter is the whole point — a face withdrawn while
    // its template was being built must not come back with one.
    const { count } = await this.prisma.faceEmbedding.updateMany({
      where: { id, active: true },
      data: { vector: [], vectorEnc: encryptVector(vector, this.config.faceEncryptionKey) },
    });
    return count > 0;
  }

  countActiveByEmployee(employeeId: string): Promise<number> {
    return this.prisma.faceEmbedding.count({ where: { employeeId, active: true } });
  }

  async listActiveVectorsExcept(employeeId: string): Promise<OwnedVector[]> {
    const rows = await this.prisma.faceEmbedding.findMany({
      where: { active: true, employeeId: { not: employeeId } },
      select: { employeeId: true, vector: true, vectorEnc: true },
    });
    return rows.map((r) => {
      const { employeeId: owner, vector } = this.plain(r, false);
      return { employeeId: owner, vector };
    });
  }

  async deleteForEmployee(employeeId: string): Promise<string[]> {
    const rows = await this.prisma.faceEmbedding.findMany({
      where: { employeeId },
      select: { sourcePhotoUrl: true },
    });
    await this.prisma.faceEmbedding.deleteMany({ where: { employeeId } });
    return rows.map((r) => r.sourcePhotoUrl).filter((v): v is string => !!v);
  }

  async deactivateForEmployee(employeeId: string): Promise<void> {
    await this.prisma.faceEmbedding.updateMany({
      where: { employeeId, active: true },
      data: { active: false },
    });
  }
}
