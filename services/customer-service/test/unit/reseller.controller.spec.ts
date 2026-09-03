import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { AuthenticatedUser, Role } from '@hydromart/platform';

import { ResellerController } from '../../src/modules/reseller.controller';
import { ResellerSelfController } from '../../src/modules/reseller-self.controller';
import { ResellerService } from '../../src/application/services/reseller.service';
import { Reseller } from '../../src/application/ports/reseller.repository';
import {
  NothingToScheduleError,
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
  flatGallonPriceIdr: 0,
  photoUrl: null,
  active: true,
  joinDate: new Date('2026-01-01'),
  note: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

function makeService(): jest.Mocked<
  Pick<ResellerService, 'list' | 'get' | 'register' | 'update' | 'priceHistory'>
> {
  return {
    list: jest.fn(),
    get: jest.fn(),
    register: jest.fn(),
    update: jest.fn(),
    priceHistory: jest.fn(),
  };
}

const importsMock = { importResellers: jest.fn() };
const storageMock = { put: jest.fn() };

function controllerWith(svc: ReturnType<typeof makeService>): ResellerController {
  return new ResellerController(
    svc as unknown as ResellerService,
    importsMock as never,
    storageMock as never,
  );
}

/** A one-pixel PNG — the sniffer reads the real bytes, not the declared mimetype. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const upload = (over: Partial<{ buffer: Buffer; size: number }> = {}) =>
  ({
    buffer: over.buffer ?? PNG,
    mimetype: 'image/png',
    size: over.size ?? PNG.length,
    originalname: 'ktp.png',
  }) as never;

const registerDto: RegisterResellerDto = {
  customerId: 'c1',
  homeDepotId: 'd1',
  monthlyTargetQty: 100,
  joinDate: '2026-01-01',
};

describe('ResellerController', () => {
  it('list delegates to the service with the depot/active filter', async () => {
    const svc = makeService();
    const view = { ...row, customerName: 'Budi' };
    svc.list.mockResolvedValue([view]);
    const out = await controllerWith(svc).list(user, { depotId: 'd1', active: true });
    expect(out).toEqual([view]);
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

  // SOP §7: the agen's registration photo, on the existing storage path.
  describe('uploadPhoto', () => {
    beforeEach(() => storageMock.put.mockReset());

    it('stores the file and records the URL on the reseller', async () => {
      const svc = makeService();
      storageMock.put.mockResolvedValue({ url: 'https://cdn/resellers/a.png', key: 'x' });
      svc.update.mockResolvedValue({ ...row, photoUrl: 'https://cdn/resellers/a.png' });
      await expect(controllerWith(svc).uploadPhoto(user, 'c1', upload())).resolves.toMatchObject({
        photoUrl: 'https://cdn/resellers/a.png',
      });
      // The content type comes from the BYTES, not from what the client declared.
      expect(storageMock.put).toHaveBeenCalledWith({
        body: PNG,
        contentType: 'image/png',
        ext: 'png',
      });
      expect(svc.update).toHaveBeenCalledWith(user, 'c1', {
        photoUrl: 'https://cdn/resellers/a.png',
      });
    });

    it('rejects a missing file', async () => {
      await expect(controllerWith(makeService()).uploadPhoto(user, 'c1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    // H-20: a .html wearing an image/png label would be a stored XSS off the bucket.
    it('rejects bytes that are not one of the allowed image formats', async () => {
      const html = Buffer.from('<html><script>alert(1)</script></html>');
      await expect(
        controllerWith(makeService()).uploadPhoto(user, 'c1', upload({ buffer: html })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storageMock.put).not.toHaveBeenCalled();
    });

    it('rejects a PDF — this field is a photo', async () => {
      const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 0, 0, 0]);
      await expect(
        controllerWith(makeService()).uploadPhoto(user, 'c1', upload({ buffer: pdf })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a file over 5MB', async () => {
      await expect(
        controllerWith(makeService()).uploadPhoto(user, 'c1', upload({ size: 6 * 1024 * 1024 })),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
    });

    it('reports storage being down as 503, not as a broken photo', async () => {
      const svc = makeService();
      storageMock.put.mockRejectedValue(new Error('endpoint unreachable'));
      await expect(controllerWith(svc).uploadPhoto(user, 'c1', upload())).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(svc.update).not.toHaveBeenCalled();
    });

    it('maps an unknown reseller to 404 and rethrows anything else', async () => {
      const svc = makeService();
      storageMock.put.mockResolvedValue({ url: 'https://cdn/x.png', key: 'x' });
      svc.update.mockRejectedValueOnce(new ResellerNotFoundError());
      await expect(controllerWith(svc).uploadPhoto(user, 'c1', upload())).rejects.toBeInstanceOf(
        NotFoundException,
      );
      const boom = new Error('boom');
      svc.update.mockRejectedValueOnce(boom);
      await expect(controllerWith(svc).uploadPhoto(user, 'c1', upload())).rejects.toBe(boom);
    });
  });

  describe('update', () => {
    it('updates on success', async () => {
      const svc = makeService();
      svc.update.mockResolvedValue({ ...row, monthlyTargetQty: 200 });
      await expect(
        controllerWith(svc).update(user, 'c1', { monthlyTargetQty: 200 }),
      ).resolves.toEqual({ ...row, monthlyTargetQty: 200 });
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

  it('returns active + both pricing shapes + the home depot for a reseller', async () => {
    // Checkout needs the flat galon price here too — it is the SOP's agen price, and
    // without it order-service would fall back to membership pricing for a flat-price agen.
    //
    // A9: and it needs `homeDepotId`, which this route did not send. order-service checks
    // `homeDepotId === sellingDepotId` before it will price an agen, and absent reads as
    // "cannot prove which depot" — which declines. Leaving it out withdrew the agen price
    // from EVERY online order, the agen's own depot included, silently.
    svc.findMy.mockResolvedValue({
      active: true,
      discountPct: 12,
      flatGallonPriceIdr: 5000,
      homeDepotId: 'depot-home',
    });
    expect(await controller.me(selfUser as never)).toEqual({
      active: true,
      discountPct: 12,
      flatGallonPriceIdr: 5000,
      homeDepotId: 'depot-home',
    });
    expect(svc.findMy).toHaveBeenCalledWith('cust-1');
  });

  it('404s when the caller is not a reseller', async () => {
    svc.findMy.mockResolvedValue(null);
    await expect(controller.me(selfUser as never)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ResellerController.import', () => {
  it('hands the rows and home depot to the import service', async () => {
    importsMock.importResellers.mockResolvedValue({
      created: 1,
      skipped: 0,
      failed: 0,
      results: [],
    });
    const rows = [{ fullName: 'Toko', phone: '0812' }];
    const user = { sub: 'mgr-1' } as never;

    await controllerWith(makeService()).import(user, { depotId: 'd1', rows } as never);

    expect(importsMock.importResellers).toHaveBeenCalledWith(user, 'd1', rows);
  });
});

describe('ResellerController price changes (K4.2)', () => {
  it('passes a future effectiveAt through as a Date, separated from the patch', async () => {
    const svc = makeService();
    svc.update.mockResolvedValue(row);

    await controllerWith(svc).update(user, 'c1', {
      discountPct: 5,
      effectiveAt: '2026-09-01T00:00:00.000Z',
    });

    expect(svc.update).toHaveBeenCalledWith(
      user,
      'c1',
      // `effectiveAt` must NOT reach the patch — it is not a column on the reseller row.
      { discountPct: 5 },
      new Date('2026-09-01T00:00:00.000Z'),
    );
  });

  it('passes undefined when no date was given, which means now', async () => {
    const svc = makeService();
    svc.update.mockResolvedValue(row);

    await controllerWith(svc).update(user, 'c1', { discountPct: 5 });

    expect(svc.update).toHaveBeenCalledWith(user, 'c1', { discountPct: 5 }, undefined);
  });

  it('answers 400 when a date was given with nothing to schedule behind it', async () => {
    const svc = makeService();
    svc.update.mockRejectedValue(new NothingToScheduleError());

    await expect(
      controllerWith(svc).update(user, 'c1', {
        note: 'x',
        effectiveAt: '2026-09-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rethrows anything that is neither a missing reseller nor an empty schedule', async () => {
    const svc = makeService();
    svc.update.mockRejectedValue(new Error('db down'));

    await expect(controllerWith(svc).update(user, 'c1', { discountPct: 5 })).rejects.toThrow(
      'db down',
    );
  });

  it('hands back the change history', async () => {
    const svc = makeService();
    svc.priceHistory.mockResolvedValue([]);

    await expect(controllerWith(svc).priceChanges(user, 'c1')).resolves.toEqual([]);
    expect(svc.priceHistory).toHaveBeenCalledWith(user, 'c1');
  });

  it('answers 404 for the history of a reseller that does not exist', async () => {
    const svc = makeService();
    svc.priceHistory.mockRejectedValue(new ResellerNotFoundError());

    await expect(controllerWith(svc).priceChanges(user, 'c1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rethrows a non-domain failure from the history read', async () => {
    const svc = makeService();
    svc.priceHistory.mockRejectedValue(new Error('db down'));

    await expect(controllerWith(svc).priceChanges(user, 'c1')).rejects.toThrow('db down');
  });
});
