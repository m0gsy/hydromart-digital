import { CartController } from '../../src/modules/cart.controller';
import { CartService } from '../../src/application/services/cart.service';

type Mocked = { [K in keyof CartService]: jest.Mock };

function makeService(): Mocked {
  return {
    view: jest.fn().mockResolvedValue({ items: [] }),
    setItem: jest.fn().mockResolvedValue({ items: ['x'] }),
    removeItem: jest.fn().mockResolvedValue({ items: [] }),
    clear: jest.fn().mockResolvedValue(undefined),
  } as unknown as Mocked;
}

const user = { sub: 'cust-1', role: 'CUSTOMER' } as never;

describe('CartController', () => {
  let service: Mocked;
  let controller: CartController;

  beforeEach(() => {
    service = makeService();
    controller = new CartController(service as unknown as CartService);
  });

  it('view: returns the caller cart', async () => {
    await expect(controller.view(user)).resolves.toEqual({ items: [] });
    expect(service.view).toHaveBeenCalledWith('cust-1', null, '');
  });

  it('add: sets the item additively (absolute=false)', async () => {
    await expect(controller.add(user, { productId: 'p1', quantity: 2 } as never)).resolves.toEqual({
      items: ['x'],
    });
    expect(service.setItem).toHaveBeenCalledWith('cust-1', 'p1', 2, false, null, '');
  });

  it('set: sets the absolute quantity (absolute=true)', async () => {
    await controller.set(user, 'p1', { quantity: 5 } as never);
    expect(service.setItem).toHaveBeenCalledWith('cust-1', 'p1', 5, true, null, '');
  });

  it('remove: removes a product line', async () => {
    await controller.remove(user, 'p1');
    expect(service.removeItem).toHaveBeenCalledWith('cust-1', 'p1', null, '');
  });

  /*
   * A2. The mutation routes carry the depot too, not just GET: they answer with the whole
   * priced cart, so a client that only sent it on GET would watch the prices flip on every
   * quantity tap. The bearer rides along because the agen preview is read on it.
   */
  it('passes the depot and the bearer through on every priced route', async () => {
    await controller.view(user, 'depot-1', 'Bearer t');
    expect(service.view).toHaveBeenCalledWith('cust-1', 'depot-1', 'Bearer t');

    await controller.add(user, { productId: 'p1', quantity: 2 } as never, 'depot-1', 'Bearer t');
    expect(service.setItem).toHaveBeenCalledWith('cust-1', 'p1', 2, false, 'depot-1', 'Bearer t');

    await controller.set(user, 'p1', { quantity: 5 } as never, 'depot-1', 'Bearer t');
    expect(service.setItem).toHaveBeenCalledWith('cust-1', 'p1', 5, true, 'depot-1', 'Bearer t');

    await controller.remove(user, 'p1', 'depot-1', 'Bearer t');
    expect(service.removeItem).toHaveBeenCalledWith('cust-1', 'p1', 'depot-1', 'Bearer t');
  });

  it('clear: empties the cart and resolves void', async () => {
    await expect(controller.clear(user)).resolves.toBeUndefined();
    expect(service.clear).toHaveBeenCalledWith('cust-1');
  });
});
