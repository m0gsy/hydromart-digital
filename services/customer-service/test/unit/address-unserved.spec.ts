import { gridCell1km, localMonthKey } from '@hydromart/platform';

import { AddressService, distanceBand } from '../../src/application/services/address.service';
import { RegionLookup } from '../../src/infrastructure/geo/region-lookup';
import { InMemoryAddressRepository, buildTestConfig } from '../support/fakes';

const input = (label: string) => ({
  label,
  recipientName: 'Budi',
  phone: '081234567890',
  addressLine: 'Jl. Merdeka 10',
  city: 'Bandung',
  province: 'Jawa Barat',
});

describe('AddressService unserved demand (HD-20b)', () => {
  const sq = [5, -7, 8, -7, 8, -6, 5, -6, 5, -7];
  const lookup = new RegionLookup({
    adm3: [{ c: '320101', n: 'Kec', b: [5, -7, 8, -6], g: [[sq]] }],
    adm4: [{ c: '3201010001', n: 'Kel', p: '320101', b: [5, -7, 8, -6], g: [[sq]] }],
  });
  const at = { latitude: -6.5, longitude: 6 };
  const placed = { ...at, pinSource: 'MANUAL' as const };
  // About 20 km east of the pin (0.18 deg of longitude near the equator), radius 5 km.
  const far = { id: 'd1', lat: -6.5, lng: 6.18, serviceRadiusKm: 5 };
  const near = { id: 'd2', lat: -6.5, lng: 6.001, serviceRadiusKm: 5 };
  const flush = () => new Promise((r) => setImmediate(r));
  const month = () => localMonthKey(new Date());
  let repo: InMemoryAddressRepository;
  let record: jest.Mock;
  let listActive: jest.Mock;

  const make = (depots: unknown) => {
    repo = new InMemoryAddressRepository();
    record = jest.fn().mockResolvedValue(undefined);
    listActive = jest.fn().mockResolvedValue(depots);
    return new AddressService(repo, buildTestConfig(), lookup, { record }, { listActive } as never);
  };

  it('records one anonymous row for a pin no depot serves, and remembers the month on the address', async () => {
    const svc = make([far]);
    const a = await svc.create('c', { ...input('A'), ...placed });
    await flush();
    expect(record).toHaveBeenCalledWith({
      monthKey: month(),
      kecamatanCode: '320101',
      kelurahanCode: '3201010001',
      gridCell: gridCell1km(-6.5, 6),
      distanceBand: '>10',
    });
    expect((await repo.findByIdForCustomer('c', a.id))?.unservedMonth).toBe(month());
  });

  it('records nothing when a depot serves the pin, or the depot list is empty or unreadable', async () => {
    for (const depots of [[near], [], null]) {
      await make(depots).create('c', { ...input('A'), ...placed });
      await flush();
      expect(record).not.toHaveBeenCalled();
    }
  });

  it('does not even read the depots for a pin with no codes (none, or too rough)', async () => {
    const svc = make([far]);
    await svc.create('c', { ...input('A'), ...at, pinSource: 'GPS', pinAccuracyM: 3000 });
    await svc.create('c', input('B'));
    await flush();
    expect(listActive).not.toHaveBeenCalled();
  });

  it('records once per address per month; a cleared pin starts over', async () => {
    const svc = make([far]);
    const a = await svc.create('c', { ...input('A'), ...placed });
    await flush();
    await svc.update('c', a.id, { ...at, city: 'X' });
    await svc.update('c', a.id, { latitude: -6.4, longitude: 6.1, pinSource: 'MANUAL' });
    await flush();
    expect(record).toHaveBeenCalledTimes(1);
    const cleared = await svc.update('c', a.id, { latitude: null, longitude: null });
    expect(cleared.unservedMonth).toBeNull();
    await svc.update('c', a.id, placed);
    await flush();
    expect(record).toHaveBeenCalledTimes(2);
  });

  it('bands the distance to the nearest depot', () => {
    expect([0.5, 1, 2, 4, 7, 11].map(distanceBand)).toEqual(['0-1', '0-1', '1-3', '3-5', '5-10', '>10']);
  });

  it('never fails the save: a record error is a warn without coordinates or ids', async () => {
    const svc = make([far]);
    record.mockRejectedValue(new Error('boom -6.5 6'));
    const warn = jest
      .spyOn((svc as unknown as { logger: { warn: () => void } }).logger, 'warn')
      .mockImplementation(() => undefined);
    await expect(svc.create('c', { ...input('A'), ...placed })).resolves.toBeDefined();
    await flush();
    expect(warn).toHaveBeenCalledWith('Unserved demand not recorded (Error)');
  });

  it('records nothing without the repository or the depot port', async () => {
    const svc = new AddressService(new InMemoryAddressRepository(), buildTestConfig(), lookup);
    await expect(svc.create('c', { ...input('A'), ...placed })).resolves.toBeDefined();
  });
});
