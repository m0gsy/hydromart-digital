import { HqPayoutExportService } from '../../src/application/services/hq-payout-export.service';
import type { PayoutBankAccountRecord } from '../../src/application/ports/bank-account.repository';

const account = (over: Partial<PayoutBankAccountRecord>): PayoutBankAccountRecord => ({
  id: 'ba-1',
  subjectId: 'owner-1',
  subjectType: 'OWNER',
  bankName: 'BCA',
  accountNumber: '1234567890',
  accountHolder: 'Budi',
  status: 'VERIFIED',
  verifiedBy: 'hq-1',
  verifiedAt: new Date('2026-01-01'),
  rejectedReason: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...over,
});

describe('HqPayoutExportService (PPA-15)', () => {
  const owners = [
    {
      id: 'w1',
      franchiseOwnerId: 'owner-1',
      amount: 500000,
      bankAccountRef: 'BCA ···· 7890',
      status: 'PROCESSING',
      reference: 'WD-1',
      createdAt: new Date('2026-02-01T03:00:00Z'),
      updatedAt: new Date(),
    },
  ];
  const couriers = [
    {
      id: 'w2',
      courierId: 'cou-1',
      amount: 75000,
      bankAccountRef: 'BNI ···· 1111',
      status: 'PROCESSING',
      reference: 'WD-2',
      createdAt: new Date('2026-02-02T03:00:00Z'),
      updatedAt: new Date(),
    },
  ];
  const payout = { listProcessingWithdrawals: jest.fn() };
  const courierPayout = { listProcessingWithdrawals: jest.fn() };
  const accounts = { mine: jest.fn() };
  const service = new HqPayoutExportService(
    payout as never,
    courierPayout as never,
    accounts as never,
  );
  const audit = jest.spyOn(service as never as { audit: () => Promise<void> }, 'audit');

  beforeEach(() => {
    jest.clearAllMocks();
    audit.mockResolvedValue(undefined);
    payout.listProcessingWithdrawals.mockResolvedValue(owners);
    courierPayout.listProcessingWithdrawals.mockResolvedValue(couriers);
  });

  it('joins each processing withdrawal to its VERIFIED account and writes one CSV line each', async () => {
    accounts.mine.mockImplementation(async (id: string) =>
      id === 'owner-1'
        ? account({})
        : account({ subjectId: 'cou-1', subjectType: 'COURIER', bankName: 'BNI', accountNumber: '9988', accountHolder: 'Sari' }),
    );
    const csv = await service.processingCsv('hq-user');
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('reference,jenis,subjectId,jumlah,dibuat,bank,noRekening,atasNama');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('WD-1,OWNER,owner-1,500000');
    expect(lines[1]).toContain('BCA,1234567890,Budi');
    expect(lines[2]).toContain('WD-2,COURIER,cou-1,75000');
    expect(lines[2]).toContain('BNI,9988,Sari');
  });

  it('never writes an account that is not VERIFIED: the row is flagged instead', async () => {
    accounts.mine.mockResolvedValue(account({ status: 'PENDING', accountNumber: '5555' }));
    const csv = await service.processingCsv('hq-user');
    expect(csv).not.toContain('5555');
    expect(csv.split('\r\n')[1]).toContain('BELUM TERVERIFIKASI');
  });

  it('flags a withdrawal whose owner has no account on file', async () => {
    accounts.mine.mockResolvedValue(null);
    const csv = await service.processingCsv('hq-user');
    expect(csv.split('\r\n')[1]).toContain('BELUM TERVERIFIKASI');
  });

  it('neutralises a spreadsheet formula typed into the account holder name', async () => {
    accounts.mine.mockResolvedValue(account({ accountHolder: '=HYPERLINK("http://x")' }));
    const csv = await service.processingCsv('hq-user');
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
  });

  it('records who read the account numbers, and how many rows', async () => {
    accounts.mine.mockResolvedValue(account({}));
    await service.processingCsv('hq-user');
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'payout.hq.export-processing',
        actorId: 'hq-user',
        metadata: { rows: 2 },
      }),
    );
  });

  it('an empty queue is a header-only file, still audited', async () => {
    payout.listProcessingWithdrawals.mockResolvedValue([]);
    courierPayout.listProcessingWithdrawals.mockResolvedValue([]);
    const csv = await service.processingCsv('hq-user');
    expect(csv.split('\r\n')).toHaveLength(1);
    expect(audit).toHaveBeenCalledTimes(1);
  });

  describe('audit()', () => {
    const real = new HqPayoutExportService(payout as never, courierPayout as never, accounts as never);
    const send = (real as never as { audit: (e: { action: string }) => Promise<void> }).audit.bind(real);
    const env = { ...process.env };
    afterEach(() => {
      process.env = { ...env };
      jest.restoreAllMocks();
    });

    it('posts to auth-service when configured', async () => {
      process.env.AUTH_SERVICE_URL = 'http://auth:3001';
      process.env.INTERNAL_SERVICE_KEY = 'k'.repeat(32);
      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
      await send({ action: 'payout.hq.export-processing' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does nothing when auth-service is not configured', async () => {
      delete process.env.AUTH_SERVICE_URL;
      delete process.env.INTERNAL_SERVICE_KEY;
      const fetchMock = jest.spyOn(global, 'fetch');
      await send({ action: 'payout.hq.export-processing' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
