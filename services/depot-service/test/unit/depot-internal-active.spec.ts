import { NotFoundException } from '@nestjs/common';

import { DepotController } from '../../src/modules/depot.controller';

const DEPOT = '11111111-1111-1111-1111-111111111111';

describe('GET depots/internal/:id/active', () => {
  function controller(get: jest.Mock) {
    return new DepotController({ get } as never, {} as never);
  }

  it('says whether the depot is open, without hiding a closed one', async () => {
    const get = jest.fn().mockResolvedValueOnce({ active: true }).mockResolvedValueOnce({ active: false });
    const c = controller(get);
    await expect(c.internalActive(DEPOT)).resolves.toEqual({ active: true });
    await expect(c.internalActive(DEPOT)).resolves.toEqual({ active: false });
    // `false` = include inactive: a closed depot must be ANSWERED, not 404.
    expect(get).toHaveBeenCalledWith(DEPOT, false);
  });

  it('lets a depot that does not exist be a 404', async () => {
    const c = controller(jest.fn().mockRejectedValue(new NotFoundException('Depot tidak ditemukan')));
    await expect(c.internalActive(DEPOT)).rejects.toBeInstanceOf(NotFoundException);
  });
});
