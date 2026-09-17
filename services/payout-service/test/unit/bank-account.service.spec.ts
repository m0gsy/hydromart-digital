import { PayoutBankAccountService } from '../../src/application/services/bank-account.service';
import { maskAccount } from '../../src/domain/bank-account';
import type {
  PayoutBankAccountRecord,
  PayoutBankAccountRepository,
  RegisterBankAccountData,
} from '../../src/application/ports/bank-account.repository';

/*
 * PYO-3, owner decision 2026-09-17 — the payout destination on file.
 *
 * A withdrawal used to carry a bank account typed into the request, checked by nobody, and
 * an HQ release reused whatever the last one said. One account per person, verified by head
 * office, and a replacement goes back for checking rather than inheriting the old tick.
 */
class FakeAccounts implements PayoutBankAccountRepository {
  rows: PayoutBankAccountRecord[] = [];

  async upsert(data: RegisterBankAccountData): Promise<PayoutBankAccountRecord> {
    const fresh = {
      ...data,
      status: 'PENDING' as const,
      verifiedBy: null,
      verifiedAt: null,
      rejectedReason: null,
      updatedAt: new Date(),
    };
    const existing = this.rows.find((r) => r.subjectId === data.subjectId);
    if (existing) {
      Object.assign(existing, fresh);
      return existing;
    }
    const row: PayoutBankAccountRecord = {
      id: `acc-${this.rows.length}`,
      createdAt: new Date(),
      ...fresh,
    };
    this.rows.push(row);
    return row;
  }

  async findBySubject(subjectId: string): Promise<PayoutBankAccountRecord | null> {
    return this.rows.find((r) => r.subjectId === subjectId) ?? null;
  }

  async findById(id: string): Promise<PayoutBankAccountRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async listByStatus(status: PayoutBankAccountRecord['status']): Promise<PayoutBankAccountRecord[]> {
    return this.rows.filter((r) => r.status === status);
  }

  async decide(
    id: string,
    data: { status: 'VERIFIED' | 'REJECTED'; verifiedBy: string; rejectedReason: string | null },
  ): Promise<PayoutBankAccountRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row || row.status !== 'PENDING') return null;
    Object.assign(row, data, { verifiedAt: new Date() });
    return row;
  }
}

const OWNER = 'owner-1';
const FINANCE = 'finance-1';
const account = { bankName: ' BCA ', accountNumber: '1234 5678 90', accountHolder: ' Budi ' };

describe('PayoutBankAccountService', () => {
  let accounts: FakeAccounts;
  let service: PayoutBankAccountService;

  beforeEach(() => {
    accounts = new FakeAccounts();
    service = new PayoutBankAccountService(accounts);
  });

  it('registers one account per person, trimmed, and waiting to be checked', async () => {
    const saved = await service.register(OWNER, 'OWNER', account);
    expect(saved).toMatchObject({
      bankName: 'BCA',
      accountNumber: '1234567890',
      accountHolder: 'Budi',
      status: 'PENDING',
    });
    expect(await service.mine(OWNER)).toMatchObject({ id: saved.id });
    expect(await service.listByStatus('PENDING')).toHaveLength(1);
  });

  it('refuses to name a destination until head office has verified one', async () => {
    await expect(service.verifiedDestination(OWNER)).rejects.toThrow(/terverifikasi/);

    const saved = await service.register(OWNER, 'OWNER', account);
    await expect(service.verifiedDestination(OWNER)).rejects.toThrow(/terverifikasi/);

    await service.decide(saved.id, FINANCE, true, null);
    // PYO-7: what the ledger records is the masked form; the full number stays on the
    // account row, where head office reads it to make the transfer.
    expect(await service.verifiedDestination(OWNER)).toBe('BCA ···· 7890');
    expect(maskAccount('BRI', '77881122')).toBe('BRI ···· 1122');
  });

  it('sends a replacement back for checking, losing the previous tick', async () => {
    const saved = await service.register(OWNER, 'OWNER', account);
    await service.decide(saved.id, FINANCE, true, null);
    await service.register(OWNER, 'OWNER', { ...account, accountNumber: '9999 0000' });

    expect(await service.mine(OWNER)).toMatchObject({ status: 'PENDING', verifiedBy: null });
    await expect(service.verifiedDestination(OWNER)).rejects.toThrow(/terverifikasi/);
  });

  it('records a rejection with its reason, and refuses to decide twice', async () => {
    const saved = await service.register(OWNER, 'OWNER', account);
    const rejected = await service.decide(saved.id, FINANCE, false, '  nama tidak cocok  ');
    expect(rejected).toMatchObject({
      status: 'REJECTED',
      verifiedBy: FINANCE,
      rejectedReason: 'nama tidak cocok',
    });
    await expect(service.decide(saved.id, FINANCE, true, null)).rejects.toThrow(/sudah diputuskan/);
    await expect(service.decide('nope', FINANCE, true, null)).rejects.toThrow(/tidak ditemukan/);
  });
});
