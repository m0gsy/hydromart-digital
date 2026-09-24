import { PaymentMethod, PaymentStatus } from '../../src/domain/payment';
import { proofKeyFromUrl } from '../../src/domain/payment-proof';
import { PaymentProofRetentionService } from '../../src/application/services/payment-proof-retention.service';
import { StoragePort } from '../../src/application/ports/storage.port';
import { InMemoryPaymentRepository } from '../support/fakes';

const CUTOFF = new Date('2026-01-01T00:00:00.000Z');
const OLD = new Date('2025-06-01T00:00:00.000Z');
const NEW = new Date('2026-06-01T00:00:00.000Z');

describe('proofKeyFromUrl', () => {
  it('takes the key from a stored URL, wherever the adapter put the base', () => {
    expect(proofKeyFromUrl('https://nos.example/bucket/payment-proof/a.jpg')).toBe(
      'payment-proof/a.jpg',
    );
    expect(proofKeyFromUrl('http://localhost/uploads/payment-proof/b.png')).toBe(
      'payment-proof/b.png',
    );
  });

  it('says so when the URL is not one this service wrote', () => {
    expect(proofKeyFromUrl('https://elsewhere.example/receipt.jpg')).toBeNull();
  });
});

describe('PaymentProofRetentionService', () => {
  let repo: InMemoryPaymentRepository;
  let storage: jest.Mocked<Pick<StoragePort, 'remove'>>;
  let service: PaymentProofRetentionService;

  const seed = async (over: {
    proofUrl: string | null;
    paidAt?: Date | null;
    createdAt?: Date;
  }): Promise<string> => {
    const created = await repo.create({
      orderId: '00000000-0000-4000-8000-000000000001',
      customerId: '00000000-0000-4000-8000-000000000002',
      method: PaymentMethod.TRANSFER,
      amount: 10_000,
      reference: null,
      instruction: null,
      gatewayData: null,
    });
    // `create` hands back a copy; the row under test is the one the repository holds.
    const row = repo.rows.find((r) => r.id === created.id) as (typeof repo.rows)[number];
    row.status = PaymentStatus.PAID;
    row.proofUrl = over.proofUrl;
    row.paidAt = over.paidAt === undefined ? OLD : over.paidAt;
    if (over.createdAt) row.createdAt = over.createdAt;
    return created.id;
  };

  beforeEach(() => {
    repo = new InMemoryPaymentRepository();
    storage = { remove: jest.fn().mockResolvedValue(undefined) };
    service = new PaymentProofRetentionService(repo, storage as unknown as StoragePort);
  });

  it('deletes the object first, then drops the pointer, and keeps the payment row', async () => {
    const id = await seed({ proofUrl: 'https://nos.example/payment-proof/old.jpg' });

    await expect(service.purgeOlderThan(CUTOFF)).resolves.toEqual({ purged: 1 });

    expect(storage.remove).toHaveBeenCalledWith('payment-proof/old.jpg');
    const row = repo.rows.find((r) => r.id === id);
    expect(row?.proofUrl).toBeNull();
    expect(row?.status).toBe(PaymentStatus.PAID);
  });

  it('leaves a receipt that is still inside its window', async () => {
    await seed({ proofUrl: 'https://nos.example/payment-proof/new.jpg', paidAt: NEW });

    await expect(service.purgeOlderThan(CUTOFF)).resolves.toEqual({ purged: 0 });
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('runs the clock from creation when the transfer was never confirmed', async () => {
    await seed({
      proofUrl: 'https://nos.example/payment-proof/unsettled.jpg',
      paidAt: null,
      createdAt: OLD,
    });

    await expect(service.purgeOlderThan(CUTOFF)).resolves.toEqual({ purged: 1 });
  });

  it('ignores payments that hold no receipt at all', async () => {
    await seed({ proofUrl: null });

    await expect(service.purgeOlderThan(CUTOFF)).resolves.toEqual({ purged: 0 });
  });

  it('only drops the pointer when the URL is not an object this service wrote', async () => {
    const id = await seed({ proofUrl: 'https://elsewhere.example/receipt.jpg' });

    await expect(service.purgeOlderThan(CUTOFF)).resolves.toEqual({ purged: 1 });

    expect(storage.remove).not.toHaveBeenCalled();
    expect(repo.rows.find((r) => r.id === id)?.proofUrl).toBeNull();
  });

  it('keeps the pointer when the object could not be deleted, and says so instead of reporting zero', async () => {
    const stuck = await seed({ proofUrl: 'https://nos.example/payment-proof/stuck.jpg' });
    const fine = await seed({ proofUrl: 'https://nos.example/payment-proof/fine.jpg' });
    storage.remove.mockImplementation(async (key: string) => {
      if (key.endsWith('stuck.jpg')) throw new Error('storage unreachable');
    });

    await expect(service.purgeOlderThan(CUTOFF)).rejects.toThrow(
      '1 payment proof(s) could not be purged (1 were)',
    );

    // The one that failed is still findable, so the next tick retries it...
    expect(repo.rows.find((r) => r.id === stuck)?.proofUrl).not.toBeNull();
    // ...and the one that did not fail is not held hostage by it.
    expect(repo.rows.find((r) => r.id === fine)?.proofUrl).toBeNull();
  });

  it('does not spin on a receipt that keeps failing', async () => {
    await seed({ proofUrl: 'https://nos.example/payment-proof/stuck.jpg' });
    storage.remove.mockRejectedValue(new Error('denied'));

    await expect(service.purgeOlderThan(CUTOFF)).rejects.toThrow('could not be purged (0 were)');
    expect(storage.remove).toHaveBeenCalledTimes(1);
  });

  it('works through more than one batch', async () => {
    for (let i = 0; i < 205; i += 1) {
      await seed({ proofUrl: `https://nos.example/payment-proof/${i}.jpg` });
    }

    await expect(service.purgeOlderThan(CUTOFF)).resolves.toEqual({ purged: 205 });
    expect(storage.remove).toHaveBeenCalledTimes(205);
  });
});
