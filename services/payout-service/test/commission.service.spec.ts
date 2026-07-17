import { CommissionService } from '../src/application/services/commission.service';
import { InvalidCommissionSchemeError } from '../src/domain/errors';
import type { CommissionSchemeRecord } from '../src/domain/commission';
import type {
  CommissionSchemeRepository,
  CreateCommissionSchemeData,
} from '../src/application/ports/commission-scheme.repository';

// In-memory fake — append-only rows; listCurrent picks the latest effectiveDate per depot.
class FakeSchemes implements CommissionSchemeRepository {
  rows: CommissionSchemeRecord[] = [];
  private seq = 0;

  async listCurrent(): Promise<CommissionSchemeRecord[]> {
    const latest = new Map<string, CommissionSchemeRecord>();
    for (const r of this.rows) {
      const cur = latest.get(r.depotId);
      if (!cur || r.effectiveDate.getTime() > cur.effectiveDate.getTime()) latest.set(r.depotId, r);
    }
    return [...latest.values()];
  }
  async createMany(rows: CreateCommissionSchemeData[]): Promise<CommissionSchemeRecord[]> {
    const created = rows.map((r) => ({ ...r, id: `s-${this.seq++}`, createdAt: new Date() }));
    this.rows.push(...created);
    return created;
  }
}

describe('CommissionService', () => {
  it('rejects a percentage outside 0..100', async () => {
    const svc = new CommissionService(new FakeSchemes());
    await expect(
      svc.apply({ effectiveDate: new Date(), items: [{ depotId: 'd1', pct: 120 }] }),
    ).rejects.toBeInstanceOf(InvalidCommissionSchemeError);
  });

  it('applies a bulk scheme and exposes the latest pct per depot', async () => {
    const repo = new FakeSchemes();
    const svc = new CommissionService(repo);

    await svc.apply({
      effectiveDate: new Date('2026-07-01'),
      items: [{ depotId: 'd1', ownerName: 'Budi', pct: 18 }],
    });
    // A newer scheme for the same depot supersedes the old one.
    await svc.apply({
      effectiveDate: new Date('2026-08-01'),
      items: [{ depotId: 'd1', ownerName: 'Budi', pct: 22 }],
    });

    const current = await svc.listCurrent();
    expect(current).toHaveLength(1);
    expect(current[0].pct).toBe(22);
  });

  it('is a no-op for an empty item list', async () => {
    const svc = new CommissionService(new FakeSchemes());
    expect(await svc.apply({ effectiveDate: new Date(), items: [] })).toEqual([]);
  });
});
