import { SubscriptionController } from '../../src/modules/subscription.controller';
import { SubscriptionService } from '../../src/application/services/subscription.service';

type Mocked = { [K in keyof SubscriptionService]: jest.Mock };

function makeService(): Mocked {
  return {
    list: jest.fn().mockResolvedValue(['sub']),
    networkSummary: jest.fn().mockResolvedValue({ total: 3 }),
    create: jest.fn().mockResolvedValue({ id: 's1' }),
    pause: jest.fn().mockResolvedValue({ id: 's1', status: 'PAUSED' }),
    resume: jest.fn().mockResolvedValue({ id: 's1', status: 'ACTIVE' }),
    cancel: jest.fn().mockResolvedValue({ id: 's1', status: 'CANCELLED' }),
    processDue: jest.fn().mockResolvedValue({ placed: 2 }),
    createForCustomer: jest.fn().mockResolvedValue({ id: 'sub-1' }),
    discountRate: jest.fn().mockReturnValue(0.08),
    changeAddress: jest.fn().mockResolvedValue({ id: 's1', addressLine: 'Jl. Baru 1' }),
    erasePerson: jest.fn().mockResolvedValue({ erased: 21 }),
  } as unknown as Mocked;
}

const user = { sub: 'cust-1', role: 'CUSTOMER' } as never;

describe('SubscriptionController', () => {
  let service: Mocked;
  let controller: SubscriptionController;

  beforeEach(() => {
    service = makeService();
    controller = new SubscriptionController(service as unknown as SubscriptionService);
  });

  /*
   * UU PDP item 13. auth-service's erasure registry calls this; the sweep in the same
   * controller is exactly why it has to exist.
   */
  it('forwards a PDP erasure by customer id', async () => {
    await controller.pdpAnonymise({ customerId: 'c1' } as never);
    expect(service.erasePerson).toHaveBeenCalledWith('c1');
  });


  it('list: returns the current customer subscriptions', async () => {
    await expect(controller.list(user)).resolves.toEqual(['sub']);
    expect(service.list).toHaveBeenCalledWith('cust-1');
  });

  it('adminSummary: delegates to the network aggregate', async () => {
    await expect(controller.adminSummary()).resolves.toEqual({ total: 3 });
    expect(service.networkSummary).toHaveBeenCalledTimes(1);
  });

  it('create: maps the DTO (address nullish fields defaulted) and parses firstDeliveryAt', async () => {
    const dto = {
      productId: 'p1',
      quantity: 2,
      frequency: 'WEEKLY',
      firstDeliveryAt: '2026-05-01T00:00:00.000Z',
      deliveryAddress: {
        recipientName: 'Budi',
        phone: '0811',
        addressLine: 'Jl 1',
        city: 'Bandung',
        province: 'Jabar',
      },
    } as never;
    await expect(controller.create(user, dto)).resolves.toEqual({ id: 's1' });
    const [customerId, arg] = service.create.mock.calls[0];
    expect(customerId).toBe('cust-1');
    expect(arg.firstDeliveryAt).toBeInstanceOf(Date);
    expect(arg.address).toEqual({
      recipientName: 'Budi',
      phone: '0811',
      addressLine: 'Jl 1',
      city: 'Bandung',
      province: 'Jabar',
      postalCode: null,
      latitude: null,
      longitude: null,
      notes: null,
    });
  });

  it('create: preserves supplied optional address fields', async () => {
    const dto = {
      productId: 'p1',
      quantity: 1,
      frequency: 'MONTHLY',
      firstDeliveryAt: '2026-05-01T00:00:00.000Z',
      deliveryAddress: {
        recipientName: 'Budi',
        phone: '0811',
        addressLine: 'Jl 1',
        city: 'Bandung',
        province: 'Jabar',
        postalCode: '40111',
        latitude: -6.9,
        longitude: 107.6,
        notes: 'pagar hijau',
      },
    } as never;
    await controller.create(user, dto);
    const [, arg] = service.create.mock.calls[0];
    expect(arg.address).toMatchObject({
      postalCode: '40111',
      latitude: -6.9,
      longitude: 107.6,
      notes: 'pagar hijau',
    });
  });

  it('pause / resume / cancel: delegate with the caller and subscription id', async () => {
    await expect(controller.pause(user, 's1')).resolves.toMatchObject({ status: 'PAUSED' });
    await expect(controller.resume(user, 's1')).resolves.toMatchObject({ status: 'ACTIVE' });
    await expect(controller.cancel(user, 's1')).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(service.pause).toHaveBeenCalledWith('cust-1', 's1');
    // D4: resume also carries "now" — the schedule has to move forward by the plan's own
    // cadence, and the clock is passed from the edge rather than read inside the service.
    expect(service.resume).toHaveBeenCalledWith('cust-1', 's1', expect.any(Date));
    expect(service.cancel).toHaveBeenCalledWith('cust-1', 's1');
  });

  it("discount: quotes the queried depot's rate, or the global one when no depot is given", () => {
    expect(controller.discount({ depotId: 'd1' })).toEqual({ rate: 0.08 });
    expect(service.discountRate).toHaveBeenCalledWith('d1');
    controller.discount({});
    expect(service.discountRate).toHaveBeenLastCalledWith(null);
  });

  /**
   * D10: the depot console's create, arriving over the internal key rather than a JWT —
   * depot-service holds no token for the customer it is acting on behalf of.
   *
   * No address in the body, deliberately: the engine reads the customer's own.
   */
  it('createInternal: builds a plan for a named customer, with no address in the body', async () => {
    await controller.createInternal({
      customerId: 'cust-9',
      productId: 'prod-9',
      quantity: 3,
      frequency: 'WEEKLY',
      firstDeliveryAt: '2026-09-01T00:00:00.000Z',
    } as never);

    expect(service.createForCustomer).toHaveBeenCalledWith('cust-9', {
      productId: 'prod-9',
      quantity: 3,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-09-01T00:00:00.000Z'),
    });
  });

  it('processDue: sweeps due subscriptions as of now', async () => {
    await expect(controller.processDue()).resolves.toEqual({ placed: 2 });
    expect(service.processDue).toHaveBeenCalledTimes(1);
    expect(service.processDue.mock.calls[0][0]).toBeInstanceOf(Date);
  });
});

/**
 * K1.9. The route maps a DTO whose optional fields are `undefined` onto a snapshot whose
 * are `null` — the same mapping the create route does, and the same reason: a column that
 * is absent and a column that is unknown must not become the same thing downstream.
 */
describe('SubscriptionController.changeAddress', () => {
  const user = { sub: 'c1' } as never;

  it('passes the full snapshot through, with the optional fields nulled', async () => {
    const service = makeService();
    const controller = new SubscriptionController(service as never);

    await controller.changeAddress(user, 's1', {
      deliveryAddress: {
        recipientName: 'Budi',
        phone: '081234567890',
        addressLine: 'Jl. Baru 1',
        city: 'Bandung',
        province: 'Jawa Barat',
      },
    } as never);

    expect(service.changeAddress).toHaveBeenCalledWith('c1', 's1', {
      recipientName: 'Budi',
      phone: '081234567890',
      addressLine: 'Jl. Baru 1',
      city: 'Bandung',
      province: 'Jawa Barat',
      postalCode: null,
      latitude: null,
      longitude: null,
      notes: null,
    });
  });

  it('keeps the optional fields when they ARE given', async () => {
    const service = makeService();
    const controller = new SubscriptionController(service as never);

    await controller.changeAddress(user, 's1', {
      deliveryAddress: {
        recipientName: 'Budi',
        phone: '081234567890',
        addressLine: 'Jl. Baru 1',
        city: 'Bandung',
        province: 'Jawa Barat',
        postalCode: '40112',
        latitude: -6.92,
        longitude: 107.61,
        notes: 'pagar hijau',
      },
    } as never);

    expect(service.changeAddress).toHaveBeenCalledWith(
      'c1',
      's1',
      expect.objectContaining({ postalCode: '40112', latitude: -6.92, notes: 'pagar hijau' }),
    );
  });
});
