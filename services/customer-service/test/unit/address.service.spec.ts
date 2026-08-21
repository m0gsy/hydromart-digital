import { AddressService } from '../../src/application/services/address.service';
import { AddressLimitError, AddressNotFoundError } from '../../src/domain/errors';
import { InMemoryAddressRepository, buildTestConfig } from '../support/fakes';

const input = (label: string) => ({
  label,
  recipientName: 'Budi',
  phone: '081234567890',
  addressLine: 'Jl. Merdeka 10',
  city: 'Bandung',
  province: 'Jawa Barat',
});

describe('AddressService', () => {
  let repo: InMemoryAddressRepository;
  let service: AddressService;
  const CUST = 'cust-1';

  beforeEach(() => {
    repo = new InMemoryAddressRepository();
    service = new AddressService(repo, buildTestConfig());
  });

  it('makes the first address primary automatically', async () => {
    const a = await service.create(CUST, input('Rumah'));
    expect(a.isPrimary).toBe(true);
  });

  it('keeps exactly one primary when adding another as primary', async () => {
    await service.create(CUST, input('Rumah'));
    const b = await service.create(CUST, { ...input('Kantor'), isPrimary: true });
    const list = await service.list(CUST);
    expect(b.isPrimary).toBe(true);
    expect(list.filter((x) => x.isPrimary)).toHaveLength(1);
  });

  it('enforces the 20-address limit (BR-004)', async () => {
    for (let i = 0; i < 20; i += 1) await service.create(CUST, input(`A${i}`));
    await expect(service.create(CUST, input('overflow'))).rejects.toBeInstanceOf(AddressLimitError);
  });

  it('switches the primary via setPrimary', async () => {
    const a = await service.create(CUST, input('Rumah'));
    const b = await service.create(CUST, input('Kantor'));
    await service.setPrimary(CUST, b.id);
    const list = await service.list(CUST);
    expect(list.find((x) => x.id === b.id)?.isPrimary).toBe(true);
    expect(list.find((x) => x.id === a.id)?.isPrimary).toBe(false);
  });

  it('promotes the most recent remaining address when the primary is deleted', async () => {
    const primary = await service.create(CUST, input('Rumah')); // primary
    const second = await service.create(CUST, input('Kantor'));
    const third = await service.create(CUST, input('Gudang'));
    await service.remove(CUST, primary.id);
    const list = await service.list(CUST);
    expect(list).toHaveLength(2);
    expect(list.find((x) => x.id === third.id)?.isPrimary).toBe(true);
    expect(list.find((x) => x.id === second.id)?.isPrimary).toBe(false);
  });

  it('does not leak or mutate another customer’s address', async () => {
    const mine = await service.create(CUST, input('Rumah'));
    await expect(service.getOrThrow('other', mine.id)).rejects.toBeInstanceOf(AddressNotFoundError);
    await expect(service.remove('other', mine.id)).rejects.toBeInstanceOf(AddressNotFoundError);
  });

  it('updates address fields', async () => {
    const a = await service.create(CUST, input('Rumah'));
    const updated = await service.update(CUST, a.id, { city: 'Jakarta' });
    expect(updated.city).toBe('Jakarta');
  });
});

/**
 * D10 · where a subscription created FOR this customer by depot staff delivers.
 *
 * The primary one, because that is the same rule the customer's own subscription screen
 * uses — one definition of "where a standing order goes" rather than two that can disagree.
 */
describe('AddressService.primary (D10)', () => {
  const build = () => {
    const repo = new InMemoryAddressRepository();
    return { repo, service: new AddressService(repo, buildTestConfig()) };
  };

  it('answers the primary address', async () => {
    const { service } = build();
    await service.create('c1', input('Rumah'));
    const second = await service.create('c1', input('Kantor'));
    await service.setPrimary('c1', second.id);

    await expect(service.primary('c1')).resolves.toMatchObject({ id: second.id });
  });

  // Falls back to the only one they have rather than answering "none" — a customer with a
  // single address has an obvious primary even if nothing ever flagged it.
  it('falls back to the first when nothing is flagged primary', async () => {
    const { repo, service } = build();
    const only = await service.create('c1', input('Rumah'));
    repo.rows.forEach((r) => {
      r.isPrimary = false;
    });
    await expect(service.primary('c1')).resolves.toMatchObject({ id: only.id });
  });

  // `null`, never an invented address: the caller refuses the subscription rather than
  // sending water to a guess.
  it('answers null for a customer with no addresses', async () => {
    const { service } = build();
    await expect(service.primary('nobody')).resolves.toBeNull();
  });
});
