import { ConflictException, NotFoundException } from '@nestjs/common';

import { AuthenticatedUser, Role } from '@hydromart/platform';

import { ResellerController } from '../../src/modules/reseller.controller';
import { ResellerSelfController } from '../../src/modules/reseller-self.controller';
import { ResellerService } from '../../src/application/services/reseller.service';
import { Reseller } from '../../src/application/ports/reseller.repository';
import {
  ResellerExistsError,
  ResellerNotFoundError,
} from '../../src/domain/errors';
import { RegisterResellerDto } from '../../src/modules/dto/reseller.dto';

const user: AuthenticatedUser = { sub: 'u1', role: Role.HEAD_OFFICE, phone: null, depotId: null };

const row: Reseller = {
  customerId: 'c1',
  homeDepotId: 'd1',
  monthlyTargetQty: 100,
  discountPct: 0,
  active: true,
  joinDate: new Date('2026-01-01'),
  note: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

function makeService(): jest.Mocked<Pick<ResellerService, 'list' | 'get' | 'register' | 'update'>> {
  return { list: jest.fn(), get: jest.fn(), register: jest.fn(), update: jest.fn() };
}

function controllerWith(svc: ReturnType<typeof makeService>): ResellerController {
  return new ResellerController(svc as unknown as ResellerService);
}

const registerDto: RegisterResellerDto = {
  customerId: 'c1',
  homeDepotId: 'd1',
  monthlyTargetQty: 100,
  joinDate: '2026-01-01',
};

describe('ResellerController', () => {
  it('list delegates to the service with the depot/active filter', async () => {
    const svc = makeService();
    svc.list.mockResolvedValue([row]);
    const out = await controllerWith(svc).list(user, { depotId: 'd1', active: true });
    expect(out).toEqual([row]);
    expect(svc.list).toHaveBeenCalledWith(user, { homeDepotId: 'd1', active: true });
  });

  describe('get', () => {
    it('returns the reseller on success', async () => {
      const svc = makeService();
      svc.get.mockResolvedValue(row);
      await expect(controllerWith(svc).get(user, 'c1')).resolves.toEqual(row);
    });
    it('maps ResellerNotFoundError to 404', async () => {
      const svc = makeService();
      svc.get.mockRejectedValue(new ResellerNotFoundError());
      await expect(controllerWith(svc).get(user, 'c1')).rejects.toBeInstanceOf(NotFoundException);
    });
    it('rethrows unexpected errors unchanged', async () => {
      const svc = makeService();
      const boom = new Error('boom');
      svc.get.mockRejectedValue(boom);
      await expect(controllerWith(svc).get(user, 'c1')).rejects.toBe(boom);
    });
  });

  describe('register', () => {
    it('registers on success', async () => {
      const svc = makeService();
      svc.register.mockResolvedValue(row);
      await expect(controllerWith(svc).register(user, registerDto)).resolves.toEqual(row);
      expect(svc.register).toHaveBeenCalledWith(
        user,
        expect.objectContaining({ customerId: 'c1', joinDate: new Date('2026-01-01') }),
      );
    });
    it('maps ResellerExistsError to 409', async () => {
      const svc = makeService();
      svc.register.mockRejectedValue(new ResellerExistsError());
      await expect(controllerWith(svc).register(user, registerDto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
    it('rethrows unexpected errors unchanged', async () => {
      const svc = makeService();
      const boom = new Error('boom');
      svc.register.mockRejectedValue(boom);
      await expect(controllerWith(svc).register(user, registerDto)).rejects.toBe(boom);
    });
  });

  describe('update', () => {
    it('updates on success', async () => {
      const svc = makeService();
      svc.update.mockResolvedValue({ ...row, monthlyTargetQty: 200 });
      await expect(controllerWith(svc).update(user, 'c1', { monthlyTargetQty: 200 })).resolves.toEqual(
        { ...row, monthlyTargetQty: 200 },
      );
    });
    it('maps ResellerNotFoundError to 404', async () => {
      const svc = makeService();
      svc.update.mockRejectedValue(new ResellerNotFoundError());
      await expect(controllerWith(svc).update(user, 'c1', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
    it('rethrows unexpected errors unchanged', async () => {
      const svc = makeService();
      const boom = new Error('boom');
      svc.update.mockRejectedValue(boom);
      await expect(controllerWith(svc).update(user, 'c1', {})).rejects.toBe(boom);
    });
  });
});

describe('ResellerSelfController', () => {
  const svc = { findMy: jest.fn() };
  const controller = new ResellerSelfController(svc as never);
  const selfUser = { sub: 'cust-1', role: Role.CUSTOMER, phone: null };

  it('returns active + discountPct for a reseller', async () => {
    svc.findMy.mockResolvedValue({ active: true, discountPct: 12 });
    expect(await controller.me(selfUser as never)).toEqual({ active: true, discountPct: 12 });
    expect(svc.findMy).toHaveBeenCalledWith('cust-1');
  });

  it('404s when the caller is not a reseller', async () => {
    svc.findMy.mockResolvedValue(null);
    await expect(controller.me(selfUser as never)).rejects.toBeInstanceOf(NotFoundException);
  });
});
