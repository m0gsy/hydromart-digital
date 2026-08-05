import { Injectable } from '@nestjs/common';
import { FaceEmbedding } from '../../../prisma/generated/client';

import {
  FaceEmbeddingRepository,
  OwnedVector,
} from '../../application/ports/face-embedding.repository';
import { HrConfigService } from '../../config/hr-config.service';
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

  /** The usable vector for a row, whichever form it was stored in. */
  private plain<T extends StoredVector>(row: T): T {
    if (!row.vectorEnc) return row;
    return { ...row, vector: decryptVector(row.vectorEnc, this.config.faceEncryptionKey) };
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

  async listActiveVectorsExcept(employeeId: string): Promise<OwnedVector[]> {
    const rows = await this.prisma.faceEmbedding.findMany({
      where: { active: true, employeeId: { not: employeeId } },
      select: { employeeId: true, vector: true, vectorEnc: true },
    });
    return rows.map((r) => {
      const { employeeId: owner, vector } = this.plain(r);
      return { employeeId: owner, vector };
    });
  }

  async deactivateForEmployee(employeeId: string): Promise<void> {
    await this.prisma.faceEmbedding.updateMany({
      where: { employeeId, active: true },
      data: { active: false },
    });
  }
}
