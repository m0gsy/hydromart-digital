import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { EmployeeDocument, EmployeeDocumentType } from '../../prisma/generated/client';
import {
  DocumentRepository,
  DocumentWrite,
  PurgeableDocument,
} from '../../src/application/ports/document.repository';
import { StoragePort, StoragePutInput } from '../../src/application/ports/storage.port';
import {
  DocumentService,
  MAX_DOCUMENT_BYTES,
  UploadedDocumentFile,
} from '../../src/application/services/document.service';
import { EmployeeService } from '../../src/application/services/employee.service';

const hr: AuthenticatedUser = { sub: 'hr-1', role: 'HR' as never, phone: null, depotId: null };

class FakeRepo implements DocumentRepository {
  rows: EmployeeDocument[] = [];
  purgeable: PurgeableDocument[] = [];
  private seq = 0;
  async create(data: DocumentWrite): Promise<EmployeeDocument> {
    const row = {
      id: `doc-${++this.seq}`,
      supersededById: null,
      createdAt: new Date(),
      ...data,
    } as unknown as EmployeeDocument;
    this.rows.push(row);
    return row;
  }
  async findById(id: string): Promise<EmployeeDocument | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async listByEmployee(employeeId: string): Promise<EmployeeDocument[]> {
    return this.rows.filter((r) => r.employeeId === employeeId);
  }
  async findCurrent(
    employeeId: string,
    type: EmployeeDocumentType,
  ): Promise<EmployeeDocument | null> {
    return (
      this.rows
        .filter((r) => r.employeeId === employeeId && r.type === type && !r.supersededById)
        .sort((a, b) => b.version - a.version)[0] ?? null
    );
  }
  async markSuperseded(id: string, supersededById: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id)!;
    row.supersededById = supersededById;
  }
  async listPurgeable(): Promise<PurgeableDocument[]> {
    return this.purgeable;
  }
  async deleteMany(ids: string[]): Promise<number> {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !ids.includes(r.id));
    this.purgeable = this.purgeable.filter((p) => !ids.includes(p.id));
    return before - this.rows.length || ids.length;
  }
}

function fakeStorage(over: Partial<StoragePort> = {}) {
  const puts: StoragePutInput[] = [];
  const removed: string[] = [];
  const storage: StoragePort = {
    put: async (input) => {
      puts.push(input);
      return { url: `https://cdn/${input.keyPrefix}/x.${input.ext}`, key: `${input.keyPrefix}/x.${input.ext}` };
    },
    remove: async (key) => {
      removed.push(key);
    },
    ...over,
  };
  return { storage, puts, removed };
}

function make(opts: { storage?: Partial<StoragePort>; employeeFound?: boolean } = {}) {
  const repo = new FakeRepo();
  const { storage, puts, removed } = fakeStorage(opts.storage);
  const employees = {
    getById: jest.fn(async (_u: AuthenticatedUser, id: string) => {
      if (opts.employeeFound === false) throw new NotFoundException('Karyawan tidak ditemukan');
      return { id, depotId: 'd1' };
    }),
  } as unknown as EmployeeService;
  return { repo, puts, removed, employees, svc: new DocumentService(repo, storage, employees) };
}

const file = (over: Partial<UploadedDocumentFile> = {}): UploadedDocumentFile => ({
  buffer: Buffer.from('scan-bytes'),
  mimetype: 'image/jpeg',
  size: 1234,
  ...over,
});

const INPUT = { employeeId: 'emp-1', type: 'KTP' as const };

describe('DocumentService.upload', () => {
  it('stores under hr/documents and records the row at version 1', async () => {
    const { puts, svc } = make();
    const doc = await svc.upload(hr, INPUT, file());
    expect(puts[0]).toMatchObject({ keyPrefix: 'hr/documents', ext: 'jpg' });
    expect(doc).toMatchObject({
      type: 'KTP',
      version: 1,
      supersededById: null,
      mimeType: 'image/jpeg',
      sizeBytes: 1234,
      uploadedBy: 'hr-1',
      expiresAt: null,
    });
  });

  it('keeps the expiry date when one is given', async () => {
    const { svc } = make();
    const doc = await svc.upload(hr, { ...INPUT, type: 'CONTRACT', expiresAt: '2027-01-31' }, file());
    expect(doc.expiresAt).toEqual(new Date('2027-01-31'));
  });

  it('a replacement is a NEW row at version 2 and supersedes the old one', async () => {
    const { repo, svc } = make();
    const first = await svc.upload(hr, INPUT, file());
    const second = await svc.upload(hr, INPUT, file());
    expect(second.version).toBe(2);
    expect(repo.rows).toHaveLength(2); // history kept, never overwritten
    expect((await repo.findById(first.id))!.supersededById).toBe(second.id);
    expect(second.supersededById).toBeNull();
  });

  it('versions each type independently', async () => {
    const { svc } = make();
    await svc.upload(hr, INPUT, file());
    const kk = await svc.upload(hr, { ...INPUT, type: 'KK' }, file());
    expect(kk.version).toBe(1);
  });

  it('accepts pdf and rejects anything outside the allowlist', async () => {
    const { svc } = make();
    expect((await svc.upload(hr, INPUT, file({ mimetype: 'application/pdf' }))).mimeType).toBe(
      'application/pdf',
    );
    await expect(
      svc.upload(hr, INPUT, file({ mimetype: 'application/zip' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a missing file and one over 5MB', async () => {
    const { svc } = make();
    await expect(svc.upload(hr, INPUT, undefined)).rejects.toThrow(BadRequestException);
    await expect(
      svc.upload(hr, INPUT, file({ size: MAX_DOCUMENT_BYTES + 1 })),
    ).rejects.toThrow(PayloadTooLargeException);
  });

  it('answers 503 when storage throws, and records nothing', async () => {
    const { repo, svc } = make({
      storage: {
        put: async () => {
          throw new Error('No value provided for input HTTP label: Bucket');
        },
      },
    });
    await expect(svc.upload(hr, INPUT, file())).rejects.toThrow(ServiceUnavailableException);
    expect(repo.rows).toHaveLength(0);
  });

  it('answers 503 when storage is the no-op adapter (empty url), rather than filing a dead link', async () => {
    const { repo, svc } = make({ storage: { put: async () => ({ url: '', key: '' }) } });
    await expect(svc.upload(hr, INPUT, file())).rejects.toThrow(/belum dikonfigurasi/);
    expect(repo.rows).toHaveLength(0);
  });

  it('goes through the employee gate (404 / wrong depot propagates)', async () => {
    const { svc } = make({ employeeFound: false });
    await expect(svc.upload(hr, INPUT, file())).rejects.toThrow(NotFoundException);
  });
});

describe('DocumentService reads', () => {
  it('lists an employee’s documents after a depot check', async () => {
    const { employees, svc } = make();
    await svc.upload(hr, INPUT, file());
    expect(await svc.list(hr, 'emp-1')).toHaveLength(1);
    expect(employees.getById).toHaveBeenCalledWith(hr, 'emp-1');
  });

  it('reads one document, including a superseded version', async () => {
    const { svc } = make();
    const first = await svc.upload(hr, INPUT, file());
    await svc.upload(hr, INPUT, file());
    expect((await svc.get(hr, first.id)).id).toBe(first.id);
  });

  it('404s on an unknown document', async () => {
    const { svc } = make();
    await expect(svc.get(hr, 'nope')).rejects.toThrow(NotFoundException);
  });
});

describe('DocumentService.purgeRetentionEligible', () => {
  const CUTOFF = new Date('2026-01-01T00:00:00.000Z');

  it('deletes the stored object as well as the row', async () => {
    const { repo, removed, svc } = make();
    repo.purgeable = [
      { id: 'doc-a', fileKey: 'hr/documents/a.jpg' },
      { id: 'doc-b', fileKey: 'hr/documents/b.pdf' },
    ];
    expect(await svc.purgeRetentionEligible(CUTOFF)).toEqual({ deleted: 2, failed: 0 });
    expect(removed).toEqual(['hr/documents/a.jpg', 'hr/documents/b.pdf']);
  });

  it('keeps the row when its object could not be deleted — the key is the only way back to the file', async () => {
    const { repo, svc } = make({
      storage: {
        remove: async (key: string) => {
          if (key.endsWith('b.pdf')) throw new Error('AccessDenied');
        },
      },
    });
    repo.purgeable = [
      { id: 'doc-a', fileKey: 'hr/documents/a.jpg' },
      { id: 'doc-b', fileKey: 'hr/documents/b.pdf' },
    ];
    expect(await svc.purgeRetentionEligible(CUTOFF)).toEqual({ deleted: 1, failed: 1 });
  });

  it('does nothing at all when nothing is eligible', async () => {
    const { removed, svc } = make();
    expect(await svc.purgeRetentionEligible(CUTOFF)).toEqual({ deleted: 0, failed: 0 });
    expect(removed).toEqual([]);
  });
});
