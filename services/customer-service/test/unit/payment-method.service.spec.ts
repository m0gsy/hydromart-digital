import { PaymentMethodService } from '../../src/application/services/payment-method.service';
import { PaymentMethodNotFoundError } from '../../src/domain/errors';
import { InMemoryPaymentMethodRepository } from '../support/fakes';

const cod = { type: 'CASH' as const, label: 'Cash on delivery' };
const gopay = { type: 'EWALLET' as const, label: 'GoPay', maskedIdentifier: '••••4821' };

describe('PaymentMethodService', () => {
  let repo: InMemoryPaymentMethodRepository;
  let service: PaymentMethodService;
  const CUST = 'cust-1';

  beforeEach(() => {
    repo = new InMemoryPaymentMethodRepository();
    service = new PaymentMethodService(repo);
  });

  it('makes the first saved method the default', async () => {
    const a = await service.create(CUST, cod);
    expect(a.isDefault).toBe(true);
    expect(a.maskedIdentifier).toBeNull();
  });

  it('keeps exactly one default when adding another as default', async () => {
    await service.create(CUST, cod);
    const b = await service.create(CUST, { ...gopay, isDefault: true });
    const list = await service.list(CUST);
    expect(b.isDefault).toBe(true);
    expect(list.filter((x) => x.isDefault)).toHaveLength(1);
  });

  it('switches the default via setDefault', async () => {
    const a = await service.create(CUST, cod);
    const b = await service.create(CUST, gopay);
    await service.setDefault(CUST, b.id);
    const list = await service.list(CUST);
    expect(list.find((x) => x.id === b.id)?.isDefault).toBe(true);
    expect(list.find((x) => x.id === a.id)?.isDefault).toBe(false);
  });

  it('promotes the most recent remaining method when the default is deleted', async () => {
    const first = await service.create(CUST, cod); // default
    const second = await service.create(CUST, gopay);
    const third = await service.create(CUST, { type: 'QRIS' as const, label: 'QRIS' });
    await service.remove(CUST, first.id);
    const list = await service.list(CUST);
    expect(list).toHaveLength(2);
    expect(list.find((x) => x.id === third.id)?.isDefault).toBe(true);
    expect(list.find((x) => x.id === second.id)?.isDefault).toBe(false);
  });

  it('does not leak or mutate another customer’s method', async () => {
    const mine = await service.create(CUST, cod);
    await expect(service.getOrThrow('other', mine.id)).rejects.toBeInstanceOf(
      PaymentMethodNotFoundError,
    );
    await expect(service.remove('other', mine.id)).rejects.toBeInstanceOf(
      PaymentMethodNotFoundError,
    );
  });

  it('updates method fields', async () => {
    const a = await service.create(CUST, gopay);
    const updated = await service.update(CUST, a.id, { label: 'GoPay Utama' });
    expect(updated.label).toBe('GoPay Utama');
  });
});
