import { randomUUID } from 'node:crypto';

import { DeliveryService } from '../../src/application/services/delivery.service';
import {
  DeliveryAlreadyExistsError,
  DeliveryNotFoundError,
  DriverBusyError,
  InvalidDeliveryTransitionError,
  NotAssignedDriverError,
  OrderCoordinationError,
} from '../../src/domain/errors';
import { DeliveryStatus } from '../../src/domain/delivery-status';
import {
  FakeOrderCoordination,
  InMemoryDeliveryRepository,
  buildTestConfig,
} from '../support/fakes';

const AUTH = 'Bearer token';
const PROOF = {
  photoUrl: 'https://cdn/x.jpg',
  signatureUrl: 'https://cdn/sig.png',
  recipientName: 'Budi',
  latitude: -6.9147,
  longitude: 107.6098,
  note: null,
};

describe('DeliveryService', () => {
  let repo: InMemoryDeliveryRepository;
  let orders: FakeOrderCoordination;
  let service: DeliveryService;
  const driver = randomUUID();
  const staff = randomUUID();

  beforeEach(() => {
    repo = new InMemoryDeliveryRepository();
    orders = new FakeOrderCoordination();
    service = new DeliveryService(repo, orders, buildTestConfig());
  });

  const assign = (driverId = driver, orderId = randomUUID()) =>
    service.assign(
      staff,
      { orderId, orderNumber: 'HM-1', driverId, destinationAddress: 'Jl. Merdeka 10' },
      AUTH,
    );

  it('assigns a driver and advances the order to DRIVER_ASSIGNED', async () => {
    const d = await assign();
    expect(d.status).toBe(DeliveryStatus.ASSIGNED);
    expect(orders.calls).toEqual([{ orderId: d.orderId, status: 'DRIVER_ASSIGNED' }]);
  });

  it('rejects a second delivery for the same order', async () => {
    const orderId = randomUUID();
    await assign(driver, orderId);
    await expect(assign(randomUUID(), orderId)).rejects.toBeInstanceOf(DeliveryAlreadyExistsError);
  });

  it('enforces one active delivery per driver (BR)', async () => {
    await assign(driver);
    await expect(assign(driver)).rejects.toBeInstanceOf(DriverBusyError);
  });

  it('lets the driver run pickup → start → complete, syncing the order each step', async () => {
    const d = await assign();
    await service.pickup(driver, d.id, AUTH);
    await service.start(driver, d.id, AUTH);
    const done = await service.complete(driver, d.id, PROOF, AUTH);

    expect(done.status).toBe(DeliveryStatus.DELIVERED);
    expect(done.proof).toMatchObject({ recipientName: 'Budi', latitude: -6.9147 });
    expect(orders.calls.map((c) => c.status)).toEqual([
      'DRIVER_ASSIGNED',
      'PICKED_UP',
      'ON_DELIVERY',
      'DELIVERED',
    ]);
  });

  it('frees the driver for a new delivery once the first is delivered', async () => {
    const d = await assign();
    await service.pickup(driver, d.id, AUTH);
    await service.start(driver, d.id, AUTH);
    await service.complete(driver, d.id, PROOF, AUTH);
    await expect(assign(driver)).resolves.toMatchObject({ status: DeliveryStatus.ASSIGNED });
  });

  it('forbids a driver acting on a delivery that is not theirs', async () => {
    const d = await assign();
    await expect(service.pickup(randomUUID(), d.id, AUTH)).rejects.toBeInstanceOf(
      NotAssignedDriverError,
    );
  });

  it('rejects an illegal transition (complete before pickup)', async () => {
    const d = await assign();
    await expect(service.complete(driver, d.id, PROOF, AUTH)).rejects.toBeInstanceOf(
      InvalidDeliveryTransitionError,
    );
  });

  it('fails closed and does not change delivery state when the order sync fails', async () => {
    const d = await assign();
    orders.throwOnAdvance = true;
    await expect(service.pickup(driver, d.id, AUTH)).rejects.toBeInstanceOf(OrderCoordinationError);
    expect((await service.getAny(d.id)).status).toBe(DeliveryStatus.ASSIGNED);
  });

  it('marks a delivery failed without touching the order', async () => {
    const d = await assign();
    const failed = await service.fail(driver, d.id, 'address not found');
    expect(failed.status).toBe(DeliveryStatus.FAILED);
    expect(failed.failureReason).toBe('address not found');
    // Only the assignment sync happened; failure does not advance the order.
    expect(orders.calls).toHaveLength(1);
  });

  it("never reveals another driver's delivery (404)", async () => {
    const d = await assign();
    await expect(service.getForDriver(randomUUID(), d.id)).rejects.toBeInstanceOf(
      DeliveryNotFoundError,
    );
  });

  it("lists only the requesting driver's deliveries", async () => {
    await assign(driver);
    const mine = await service.listForDriver(driver, {});
    const others = await service.listForDriver(randomUUID(), {});
    expect(mine.total).toBe(1);
    expect(others.total).toBe(0);
  });
});
