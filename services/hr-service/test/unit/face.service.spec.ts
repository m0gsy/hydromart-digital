import { BadRequestException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { FaceEmbedding } from '../../prisma/generated/client';
import { HrConfigService } from '../../src/config/hr-config.service';
import { FaceService } from '../../src/application/services/face.service';
import { EmployeeService } from '../../src/application/services/employee.service';
import { FaceVerifier } from '../../src/application/ports/face-verifier.port';
import {
  FaceEmbeddingRepository,
  OwnedVector,
} from '../../src/application/ports/face-embedding.repository';

const user: AuthenticatedUser = { sub: 's', role: 'HR' as never, phone: null, depotId: null };

class FakeFaceRepo implements FaceEmbeddingRepository {
  created: unknown[] = [];
  others: OwnedVector[] = [];
  deactivated: string[] = [];
  async create(data: {
    employeeId: string;
    vector: number[];
    quality: number;
    sourcePhotoUrl: string | null;
  }): Promise<FaceEmbedding> {
    this.created.push(data);
    return { id: 'fe1', ...data, active: true } as unknown as FaceEmbedding;
  }
  async listActiveByEmployee(): Promise<FaceEmbedding[]> {
    return [];
  }
  async listActiveVectorsExcept(): Promise<OwnedVector[]> {
    return this.others;
  }
  async deactivateForEmployee(id: string): Promise<void> {
    this.deactivated.push(id);
  }
}

const verifier = (vector: number[]): FaceVerifier => ({
  enroll: async () => ({ vector, quality: 0.9 }),
  verify: async () => ({ score: 1, matched: true, live: true }),
});

const config = { faceDuplicateThreshold: 0.75, faceMatchThreshold: 0.62 } as HrConfigService;
const employees = { getById: async () => ({ id: 'e1', depotId: 'd1' }) } as unknown as EmployeeService;

function make(v: number[], repo = new FakeFaceRepo()) {
  return { repo, svc: new FaceService(verifier(v), repo, employees, config) };
}

describe('FaceService.enroll', () => {
  it('stores an embedding and retires the previous set', async () => {
    const { repo, svc } = make([1, 0, 0]);
    await svc.enroll(user, 'e1', [Buffer.from('a')], 'photo/x.jpg');
    expect(repo.deactivated).toEqual(['e1']);
    expect(repo.created).toHaveLength(1);
    expect(repo.created[0]).toMatchObject({ employeeId: 'e1', sourcePhotoUrl: 'photo/x.jpg' });
  });

  it('rejects a face that matches another employee above the dup threshold', async () => {
    const repo = new FakeFaceRepo();
    repo.others = [{ employeeId: 'other', vector: [1, 0, 0] }];
    const { svc } = make([1, 0, 0], repo); // cosine 1.0 >= 0.75
    await expect(svc.enroll(user, 'e1', [Buffer.from('a')], null)).rejects.toThrow(BadRequestException);
    expect(repo.created).toHaveLength(0);
  });

  it('allows enroll when the closest other face is below the dup threshold', async () => {
    const repo = new FakeFaceRepo();
    repo.others = [{ employeeId: 'other', vector: [0, 1, 0] }]; // orthogonal → ~0
    const { svc } = make([1, 0, 0], repo);
    await expect(svc.enroll(user, 'e1', [Buffer.from('a')], null)).resolves.toBeDefined();
  });

  it('rejects an empty frame list', async () => {
    const { svc } = make([1, 0, 0]);
    await expect(svc.enroll(user, 'e1', [], null)).rejects.toThrow(BadRequestException);
  });
});
