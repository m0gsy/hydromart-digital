import {
  assertValidOwners,
  ownerIdsOf,
  primaryOwnerId,
  soleOwner,
} from '../../src/domain/depot-owners';
import { InvalidOwnerSharesError } from '../../src/domain/errors';

const A = '11111111-1111-4111-8111-111111111111';

describe('depot owners', () => {
  it('rejects an empty set', () => {
    expect(() => assertValidOwners([])).toThrow(InvalidOwnerSharesError);
  });

  it('promotes a lone owner to primary', () => {
    expect(assertValidOwners([{ ownerId: A, sharePct: 100, isPrimary: false }])).toEqual(
      soleOwner(A),
    );
  });

  it('reads ids from owners, falls back to the mirrored primary, and is empty for none', () => {
    expect(ownerIdsOf({ ownerId: A, owners: [] })).toEqual([]);
    expect(ownerIdsOf({ ownerId: A })).toEqual([A]);
    expect(ownerIdsOf({ ownerId: null })).toEqual([]);
    expect(primaryOwnerId([])).toBeNull();
  });
});
