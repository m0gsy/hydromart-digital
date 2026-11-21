import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { FaceEmbedding } from '../../prisma/generated/client';
import { HrConfigService } from '../../src/config/hr-config.service';
import { FaceService } from '../../src/application/services/face.service';
import { EmployeeService } from '../../src/application/services/employee.service';
import { FaceReplaceFailedError, FaceVerifier } from '../../src/application/ports/face-verifier.port';
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
  active = 0;
  async countActiveByEmployee(): Promise<number> {
    return this.active;
  }
  async listActiveWithoutLocalTemplate(): Promise<{ id: string; employeeId: string; sourcePhotoUrl: string | null }[]> {
    return [];
  }
  async setVectorIfActive(): Promise<boolean> {
    return true;
  }
  async listActiveVectorsExcept(): Promise<OwnedVector[]> {
    return this.others;
  }
  async deactivateForEmployee(id: string): Promise<void> {
    this.deactivated.push(id);
  }
  deleted: string[] = [];
  async deleteForEmployee(id: string): Promise<string[]> {
    this.deleted.push(id);
    return ['hr/faces/a.jpg'];
  }
}

const verifier = (vector: number[]): FaceVerifier => ({
  enroll: async () => ({ vector, quality: 0.9 }),
  verify: async () => ({ score: 1, matched: true, live: true }),
});

const config = { faceDuplicateThreshold: 0.75, faceMatchThreshold: 0.62 } as HrConfigService;
/** HR-3: the employee the enrolment resolves to, and the consent written against them. */
function fakeEmployees(faceConsentAt: Date | null = null) {
  const consents: { id: string; consent: unknown }[] = [];
  const employee = { id: 'e1', depotId: 'd1', fullName: 'Budi', faceConsentAt, status: 'ACTIVE' };
  return {
    consents,
    service: {
      getById: async () => employee,
      getSelf: async () => employee,
      setFaceConsent: async (id: string, consent: unknown) => {
        consents.push({ id, consent });
      },
    } as unknown as EmployeeService,
  };
}

function make(v: number[], repo = new FakeFaceRepo(), consentAt: Date | null = new Date()) {
  const employees = fakeEmployees(consentAt);
  return {
    repo,
    employees,
    svc: new FaceService(verifier(v), repo, employees.service, config),
  };
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
    await expect(svc.enroll(user, 'e1', [Buffer.from('a')], null)).rejects.toThrow(
      BadRequestException,
    );
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

  // 2026-11-21: a re-enrolment that deleted the old face and failed to take the new one left an
  // enrolment HR still called active, so every punch after it met "UserID Not Found".
  it('retires the enrolment when the engine dropped the old face and did not take the new one', async () => {
    const repo = new FakeFaceRepo();
    const refusal = new BadRequestException('Wajah tidak terdeteksi');
    const failing: FaceVerifier = {
      enroll: async () => {
        throw new FaceReplaceFailedError(refusal);
      },
      verify: async () => ({ score: 1, matched: true }),
    };
    const employees = fakeEmployees(new Date());
    const svc = new FaceService(failing, repo, employees.service, config);
    // The employee reads the refusal itself, as before; HR no longer holds a face that is gone.
    await expect(svc.enroll(user, 'e1', [Buffer.from('a')], null)).rejects.toBe(refusal);
    expect(repo.deactivated).toEqual(['e1']);
    expect(repo.created).toHaveLength(0);
  });

  it('still answers with the refusal when the enrolment cannot be retired', async () => {
    const repo = new FakeFaceRepo();
    repo.deactivateForEmployee = async () => {
      throw new Error('db down');
    };
    const refusal = new BadRequestException('Wajah tidak terdeteksi');
    const failing: FaceVerifier = {
      enroll: async () => {
        throw new FaceReplaceFailedError(refusal);
      },
      verify: async () => ({ score: 1, matched: true }),
    };
    const svc = new FaceService(failing, repo, fakeEmployees(new Date()).service, config);
    await expect(svc.enroll(user, 'e1', [Buffer.from('a')], null)).rejects.toBe(refusal);
  });

  it('leaves the enrolment alone when an enrolment fails before anything was deleted', async () => {
    const repo = new FakeFaceRepo();
    const failing: FaceVerifier = {
      enroll: async () => {
        throw new BadRequestException('Wajah tidak terdeteksi');
      },
      verify: async () => ({ score: 1, matched: true }),
    };
    const svc = new FaceService(failing, repo, fakeEmployees(new Date()).service, config);
    await expect(svc.enroll(user, 'e1', [Buffer.from('a')], null)).rejects.toThrow('Wajah tidak terdeteksi');
    expect(repo.deactivated).toEqual([]);
  });
});

/*
 * HR-3. Enrolment took any frames it was sent: consent was never asked, never recorded and
 * never checked, and biometrics are the one kind of personal data that cannot be reissued
 * after a leak. "Never asked" has to be refused exactly like "refused".
 */
describe('FaceService biometric consent (HR-3)', () => {
  it('refuses to enrol an employee who has never consented', async () => {
    const { svc, repo } = make([1, 0, 0], new FakeFaceRepo(), null);
    await expect(svc.enroll(user, 'e1', [Buffer.from('a')], null)).rejects.toThrow(
      ForbiddenException,
    );
    expect(repo.created).toHaveLength(0);
  });

  it('records the consent sent with the request, then enrols', async () => {
    const { svc, repo, employees } = make([1, 0, 0], new FakeFaceRepo(), null);
    await svc.enroll(user, 'e1', [Buffer.from('a')], null, true);
    expect(employees.consents).toEqual([{ id: 'e1', consent: { by: 's', source: 'HR_DESK' } }]);
    expect(repo.created).toHaveLength(1);
  });

  it('marks a self-enrolment as the employee’s own consent', async () => {
    const { svc, employees } = make([1, 0, 0], new FakeFaceRepo(), null);
    await svc.enrollSelf(user, [Buffer.from('a')], true);
    expect(employees.consents).toEqual([{ id: 'e1', consent: { by: 's', source: 'SELF' } }]);
  });

  it('tells the caller whether they have a face to be matched against (flow 5d)', async () => {
    const none = make([1, 0, 0]);
    await expect(none.svc.selfEnrolled(user)).resolves.toEqual({ enrolled: false });
    const repo = new FakeFaceRepo();
    repo.active = 2;
    // Counted, never read: the verify set (decrypted templates) is not asked for.
    repo.listActiveByEmployee = async () => {
      throw new Error('a yes/no read must not decrypt templates');
    };
    await expect(make([1, 0, 0], repo).svc.selfEnrolled(user)).resolves.toEqual({ enrolled: true });
  });

  it('refuses a record that is not ACTIVE, as the punch would, so no camera is offered for it', async () => {
    const employees = fakeEmployees(new Date());
    const svc = new FaceService(
      verifier([1, 0, 0]),
      new FakeFaceRepo(),
      {
        ...employees.service,
        getSelf: async () => ({ id: 'e1', status: 'SUSPENDED' }),
      } as unknown as EmployeeService,
      config,
    );
    await expect(svc.selfEnrolled(user)).rejects.toThrow('Karyawan tidak aktif');
  });

  it('does not ask again once a consent is on file', async () => {
    const { svc, employees } = make([1, 0, 0]);
    await svc.enrollSelf(user, [Buffer.from('a')]);
    expect(employees.consents).toHaveLength(0);
  });

  it('withdrawal deletes every template, the stored frame, and the consent', async () => {
    const storage = { remove: jest.fn().mockResolvedValue(undefined) };
    const repo = new FakeFaceRepo();
    const employees = fakeEmployees(new Date());
    const svc = new FaceService(
      verifier([1, 0, 0]),
      repo,
      employees.service,
      config,
      storage as never,
    );
    await expect(svc.withdrawConsent({ id: 'e1' })).resolves.toEqual({ deleted: 1 });
    expect(repo.deleted).toEqual(['e1']);
    expect(employees.consents).toEqual([{ id: 'e1', consent: null }]);
    expect(storage.remove).toHaveBeenCalledWith('hr/faces/a.jpg');
  });

  it('still withdraws when the bucket refuses the delete', async () => {
    const storage = { remove: jest.fn().mockRejectedValue(new Error('down')) };
    const employees = fakeEmployees(new Date());
    const svc = new FaceService(
      verifier([1, 0, 0]),
      new FakeFaceRepo(),
      employees.service,
      config,
      storage as never,
    );
    await expect(svc.withdrawConsent({ id: 'e1' })).resolves.toEqual({ deleted: 1 });
    expect(employees.consents).toEqual([{ id: 'e1', consent: null }]);
  });

  // A deployment with no storage adapter configured still has to withdraw: the template is
  // what makes a face usable, and it is gone either way.
  it('withdraws with no storage adapter configured', async () => {
    const { svc, employees } = make([1, 0, 0]);
    await expect(svc.withdrawConsent({ id: 'e1' })).resolves.toEqual({ deleted: 1 });
    expect(employees.consents).toEqual([{ id: 'e1', consent: null }]);
  });

  // Until 2026-10-20 a withdrawal cleared only our table; the face stayed in the provider's
  // gallery, and the next enroll collided with it.
  it('also removes the face from the engine gallery', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    const employees = fakeEmployees(new Date());
    const svc = new FaceService(
      { ...verifier([1, 0, 0]), remove } as never,
      new FakeFaceRepo(),
      employees.service,
      config,
    );
    await expect(svc.withdrawConsent({ id: 'e1', fullName: 'Budi' })).resolves.toEqual({
      deleted: 1,
    });
    expect(remove).toHaveBeenCalledWith({ userId: 'e1', userName: 'Budi' });
  });

  it('still withdraws locally when the engine gallery cannot be reached', async () => {
    const remove = jest.fn().mockRejectedValue(new Error('NEO down'));
    const employees = fakeEmployees(new Date());
    const svc = new FaceService(
      { ...verifier([1, 0, 0]), remove } as never,
      new FakeFaceRepo(),
      employees.service,
      config,
    );
    await expect(svc.withdrawConsent({ id: 'e1' })).resolves.toEqual({ deleted: 1 });
    expect(employees.consents).toEqual([{ id: 'e1', consent: null }]);
  });

  it('resolves the subject of a withdrawal: by id for HR, own record for self', async () => {
    const { svc } = make([1, 0, 0]);
    await expect(svc.employeeFor(user, 'e1')).resolves.toMatchObject({ id: 'e1' });
    await expect(svc.employeeFor(user)).resolves.toMatchObject({ id: 'e1' });
  });
});
