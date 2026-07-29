import { ASSET_TRANSITIONS, applyAssetMove, assetMoveError } from '../../src/domain/asset';
import type { AssetMovementKind, AssetStatus } from '../../prisma/generated/client';

const KINDS: AssetMovementKind[] = ['ASSIGN', 'TRANSFER', 'RETURN', 'MAINTENANCE', 'LOST'];
const STATUSES: AssetStatus[] = ['AVAILABLE', 'ASSIGNED', 'RETURNED', 'MAINTENANCE', 'LOST'];

describe('asset transitions (B3)', () => {
  it('hands a new item out and takes it back', () => {
    expect(assetMoveError('AVAILABLE', 'ASSIGN', 'e1')).toBeNull();
    expect(applyAssetMove('ASSIGN', 'e1')).toEqual({ status: 'ASSIGNED', holderId: 'e1' });
    expect(assetMoveError('ASSIGNED', 'RETURN', null)).toBeNull();
    expect(applyAssetMove('RETURN', null)).toEqual({ status: 'RETURNED', holderId: null });
    // A returned item is assignable again — that is the whole point of keeping it apart
    // from AVAILABLE rather than collapsing the two.
    expect(assetMoveError('RETURNED', 'ASSIGN', 'e2')).toBeNull();
  });

  it('refuses to hand out something already in someone else’s hands', () => {
    expect(assetMoveError('ASSIGNED', 'ASSIGN', 'e2')).toBe(
      'Aset berstatus ASSIGNED tidak bisa ASSIGN',
    );
    // TRANSFER is the legal way to do it, and it keeps the item ASSIGNED to the new person.
    expect(assetMoveError('ASSIGNED', 'TRANSFER', 'e2')).toBeNull();
    expect(applyAssetMove('TRANSFER', 'e2')).toEqual({ status: 'ASSIGNED', holderId: 'e2' });
  });

  it('demands a recipient exactly when the item ends up with a person', () => {
    expect(assetMoveError('AVAILABLE', 'ASSIGN', null)).toBe(
      'Pergerakan ASSIGN membutuhkan karyawan penerima',
    );
    expect(assetMoveError('ASSIGNED', 'TRANSFER', null)).toBe(
      'Pergerakan TRANSFER membutuhkan karyawan penerima',
    );
    for (const kind of ['RETURN', 'MAINTENANCE', 'LOST'] as AssetMovementKind[]) {
      expect(assetMoveError('ASSIGNED', kind, null)).toBeNull();
    }
  });

  it('brings an item back from the workshop and never re-assigns it while it is there', () => {
    expect(assetMoveError('ASSIGNED', 'MAINTENANCE', null)).toBeNull();
    expect(applyAssetMove('MAINTENANCE', 'e1')).toEqual({ status: 'MAINTENANCE', holderId: null });
    expect(assetMoveError('MAINTENANCE', 'ASSIGN', 'e1')).toBe(
      'Aset berstatus MAINTENANCE tidak bisa ASSIGN',
    );
    expect(assetMoveError('MAINTENANCE', 'RETURN', null)).toBeNull();
  });

  it('treats LOST as terminal — a write-off is not undone by finding it', () => {
    expect(assetMoveError('AVAILABLE', 'LOST', null)).toBeNull();
    expect(applyAssetMove('LOST', 'e1')).toEqual({ status: 'LOST', holderId: null });
    for (const kind of KINDS) {
      expect(assetMoveError('LOST', kind, 'e1')).toBe(`Aset berstatus LOST tidak bisa ${kind}`);
    }
  });

  it('rejects a kind outside the table instead of silently moving the asset', () => {
    expect(assetMoveError('AVAILABLE', 'SCRAP' as AssetMovementKind, null)).toBe(
      'Jenis pergerakan SCRAP tidak dikenal',
    );
  });

  it('covers every status/kind pair with a verdict and never lands outside the enum', () => {
    for (const status of STATUSES) {
      for (const kind of KINDS) {
        const err = assetMoveError(status, kind, 'e1');
        expect(err === null || typeof err === 'string').toBe(true);
        if (err === null) expect(STATUSES).toContain(ASSET_TRANSITIONS[kind].to);
      }
    }
  });
});
