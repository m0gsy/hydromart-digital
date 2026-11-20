import { CustomerImportService } from '../../src/application/services/customer-import.service';
import { parseLocation, pinFromRow, PinLocationError } from '../../src/domain/pin-location';

/**
 * 2026-11-20 (address package 2): imported addresses arrived with no pin, and an order needs
 * one. A file can now carry it — latitude + longitude columns, or a Google Maps link — and a
 * re-upload fills the pin an address never had.
 */
describe('parseLocation', () => {
  it.each([
    ['-6.914744, 107.609810', -6.914744, 107.60981],
    ['−6.9147,107.6098', -6.9147, 107.6098],
    ['https://maps.google.com/?q=-6.9147%2C107.6098', -6.9147, 107.6098],
    ['https://www.google.com/maps/@-6.9147,107.6098,17z', -6.9147, 107.6098],
    ['https://www.google.com/maps/place/X/@-6.1,106.1,17z/data=!3d-6.2001!4d106.8002', -6.2001, 106.8002],
    ['-6.91, 107.61', -6.91, 107.61],
  ])('reads %s', (text, latitude, longitude) => {
    expect(parseLocation(text)).toEqual({ latitude, longitude });
  });

  it.each([
    ['https://maps.app.goo.gl/abc', /Link pendek/],
    ['https://goo.gl/maps/xyz', /Link pendek/],
    ['107.6098, -6.9147', /Tidak ada koordinat/],
    ['95.1234, 10.1234', /luar jangkauan/],
    ['0.00, 0.00', /0,0/],
    ['pagar hijau', /Tidak ada koordinat/],
  ])('refuses %s, saying why', (text, why) => {
    expect(() => parseLocation(text)).toThrow(why);
  });

  it('survives a stray percent sign', () => {
    expect(parseLocation('100% -6.91, 107.61')).toEqual({ latitude: -6.91, longitude: 107.61 });
  });
});

describe('pinFromRow', () => {
  it('takes the two columns, both or neither', () => {
    expect(pinFromRow({ latitude: -6.9, longitude: 107.6 })).toEqual({ latitude: -6.9, longitude: 107.6 });
    expect(() => pinFromRow({ latitude: -6.9 })).toThrow(PinLocationError);
    expect(() => pinFromRow({ longitude: 107.6 })).toThrow(/bersamaan/);
  });

  it('prefers the columns over the link, reads the link otherwise, and is null with neither', () => {
    expect(pinFromRow({ latitude: -6.9, longitude: 107.6, mapsLink: '-1.11, 101.11' })).toEqual({
      latitude: -6.9,
      longitude: 107.6,
    });
    expect(pinFromRow({ mapsLink: 'https://maps.google.com/?q=-6.2,106.8' })).toEqual({
      latitude: -6.2,
      longitude: 106.8,
    });
    expect(pinFromRow({ mapsLink: '  ' })).toBeNull();
    expect(pinFromRow({})).toBeNull();
  });
});

const DEPOT = '11111111-1111-1111-1111-111111111111';
const user = { sub: 'staff-1', role: 'KEPALA_DEPOT', depotIds: [DEPOT] } as never;
const row = { phone: '0811', recipientName: 'Siti', addressLine: 'Jl. Melati 3', city: 'Bekasi' };

function build(existing: { id?: string; addressLine: string; city: string; latitude?: number | null }[] = []) {
  const create = jest.fn(async (_c: string, a: Record<string, unknown>) => ({ id: 'addr-1', ...a }));
  const update = jest.fn(async () => ({}));
  const addresses = { list: jest.fn(async () => existing), create, update };
  const identity = {
    preRegisterCustomer: jest.fn(async () => ({ customerId: 'c-1', status: 'pending' })),
  };
  const profiles = { upsertFavoriteDepot: jest.fn() };
  const svc = new CustomerImportService(identity as never, profiles as never, addresses as never, {} as never);
  return { svc, create, update, identity };
}

describe('the address import, with pins', () => {
  it('stores the pin from the columns or from a Maps link', async () => {
    const { svc, create } = build();
    const r = await svc.importAddresses(user, DEPOT, [
      { ...row, latitude: -6.24, longitude: 106.99 },
      { ...row, addressLine: 'Jl. Mawar 9', mapsLink: 'https://maps.google.com/?q=-6.25,107.0' },
    ]);
    expect(r).toMatchObject({ created: 2, failed: 0 });
    expect(create.mock.calls[0][1]).toMatchObject({ latitude: -6.24, longitude: 106.99 });
    expect(create.mock.calls[1][1]).toMatchObject({ latitude: -6.25, longitude: 107.0 });
  });

  it('fails the row on a short link or half a pin, with the reason', async () => {
    const { svc, create } = build();
    const r = await svc.importAddresses(user, DEPOT, [
      { ...row, mapsLink: 'https://maps.app.goo.gl/abc' },
      { ...row, latitude: -6.24 },
    ]);
    expect(r.results.map((x) => x.status)).toEqual(['failed', 'failed']);
    expect(r.results[0]!.message).toMatch(/Link pendek/);
    expect(create).not.toHaveBeenCalled();
  });

  it('fills the pin an existing address never had, and leaves one it has', async () => {
    const pinless = build([{ id: 'a-old', addressLine: 'Jl. Melati 3', city: 'Bekasi', latitude: null }]);
    const filled = await pinless.svc.importAddresses(user, DEPOT, [{ ...row, latitude: -6.24, longitude: 106.99 }]);
    expect(filled.results[0]).toMatchObject({ status: 'updated', id: 'a-old' });
    expect(pinless.update).toHaveBeenCalledWith('c-1', 'a-old', { latitude: -6.24, longitude: 106.99 });

    const pinned = build([{ id: 'a-old', addressLine: 'Jl. Melati 3', city: 'Bekasi', latitude: -6.1 }]);
    const kept = await pinned.svc.importAddresses(user, DEPOT, [{ ...row, latitude: -6.24, longitude: 106.99 }]);
    expect(kept.results[0]).toMatchObject({ status: 'skipped' });
    expect(pinned.update).not.toHaveBeenCalled();
  });
});

describe('the customer import, with pins', () => {
  const customer = { fullName: 'Siti', phone: '081200001111' };

  it('stores the pin with the address, and fills it on a re-upload', async () => {
    const fresh = build();
    await fresh.svc.importCustomers(user, DEPOT, [
      { ...customer, addressLine: 'Jl. Melati 3', city: 'Bekasi', latitude: -6.24, longitude: 106.99 },
    ]);
    expect(fresh.create.mock.calls[0][1]).toMatchObject({ latitude: -6.24, longitude: 106.99 });

    const again = build([{ id: 'a-old', addressLine: 'Jl. Melati 3', city: 'Bekasi', latitude: null }]);
    await again.svc.importCustomers(user, DEPOT, [
      { ...customer, addressLine: 'Jl. Melati 3', city: 'Bekasi', mapsLink: '-6.24, 106.99' },
    ]);
    expect(again.update).toHaveBeenCalledWith('c-1', 'a-old', { latitude: -6.24, longitude: 106.99 });
  });

  it('fails a row with a pin but no address, before creating anybody', async () => {
    const { svc, identity } = build();
    const r = await svc.importCustomers(user, DEPOT, [{ ...customer, latitude: -6.24, longitude: 106.99 }]);
    expect(r.results[0]).toMatchObject({ status: 'failed', message: expect.stringMatching(/Pin perlu alamat/) });
    expect(identity.preRegisterCustomer).not.toHaveBeenCalled();
  });
});
