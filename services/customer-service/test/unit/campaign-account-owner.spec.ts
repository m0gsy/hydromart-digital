import { ServiceUnavailableException } from '@nestjs/common';

import { ProfileService } from '../../src/application/services/profile.service';
import { buildTestConfig } from '../support/fakes';

/**
 * Owner decision 2026-11-20: a campaign or a promo message goes to the ACCOUNT OWNER — the
 * person who consented — not to the primary address's recipient (a guard, a neighbour, a
 * relative). The directory query still decides WHO is in the audience; only the number and
 * the name come from the account.
 */
const ROWS = [
  { customerId: 'c1', name: 'Satpam Rumah', phone: '0811' },
  { customerId: 'c2', name: 'Tetangga', phone: '0822' },
];

const make = (owners: Map<string, { fullName: string | null; phone: string | null }>) => {
  const profiles = {
    findSegment: jest.fn().mockResolvedValue(ROWS),
    findRecipient: jest.fn().mockResolvedValue(ROWS[0]),
  };
  const identity = {
    getAccountOwners: jest.fn().mockResolvedValue(owners),
    getCustomerNames: jest.fn(),
    preRegisterCustomer: jest.fn(),
  };
  return new ProfileService(
    profiles as never,
    {} as never,
    {} as never,
    buildTestConfig(),
    identity as never,
  );
};

describe('campaign recipients are the account owners', () => {
  it('sends to the owner, and keeps a row it cannot resolve with no number (the directory is paged)', async () => {
    const svc = make(new Map([['c1', { fullName: 'Budi', phone: '+628111' }]]));
    await expect(svc.findSegment({})).resolves.toEqual([
      { customerId: 'c1', name: 'Budi', phone: '+628111' },
      { customerId: 'c2', name: '', phone: '' },
    ]);
  });

  it('passes on an outage from the strict lookup instead of answering part of the audience', async () => {
    const svc = make(new Map());
    (svc as unknown as { identity: { getAccountOwners: jest.Mock } }).identity.getAccountOwners.mockRejectedValue(
      new ServiceUnavailableException('auth-service tidak menjawab'),
    );
    await expect(svc.findSegment({})).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('keeps a customer with no account in place, with no number and no borrowed name', async () => {
    await expect(make(new Map()).findSegment({})).resolves.toEqual([
      { customerId: 'c1', name: '', phone: '' },
      { customerId: 'c2', name: '', phone: '' },
    ]);
  });

  it('gives one recipient as the owner, or nobody when the owner has no number', async () => {
    await expect(
      make(new Map([['c1', { fullName: null, phone: '+628111' }]])).findRecipient('c1'),
    ).resolves.toEqual({ customerId: 'c1', name: '', phone: '+628111' });
    await expect(
      make(new Map([['c1', { fullName: 'Budi', phone: null }]])).findRecipient('c1'),
    ).resolves.toBeNull();
  });

  it('answers nobody when the customer has no directory row at all', async () => {
    const svc = make(new Map([['c1', { fullName: 'Budi', phone: '+628111' }]]));
    (svc as unknown as { profiles: { findRecipient: jest.Mock } }).profiles.findRecipient.mockResolvedValue(
      null,
    );
    await expect(svc.findRecipient('c9')).resolves.toBeNull();
  });
});
