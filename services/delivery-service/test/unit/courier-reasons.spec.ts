import { randomUUID } from 'node:crypto';

import { BadRequestException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { DeliveryService } from '../../src/application/services/delivery.service';
import { ShiftService } from '../../src/application/services/shift.service';
import { ContactMethod, NO_SHOW_REASON } from '../../src/domain/no-show';
import { initiatorOf } from '../../src/domain/sla';
import { DriverDeliveryController } from '../../src/modules/driver-delivery.controller';
import { FailDeliveryDto, RescheduleDeliveryDto } from '../../src/modules/dto/delivery.dto';
import {
  FakeCourierPayout,
  FakeDepotLocation,
  FakeOrderCoordination,
  FakeOrderLookup,
  FakeOrderPayment,
  InMemoryDeliveryRepository,
  InMemoryShiftRepository,
  buildTestConfig,
} from '../support/fakes';

/** Owner decisions 25 Nov: a fixed failure reason + optional note; a reschedule says who asked. */
const AUTH = 'Bearer token';
const DEPOT = '00000000-0000-4000-8000-000000000001';
const AT_DEPOT = { lat: -6.9147, lng: 107.6098 };

describe('courier failure and reschedule reasons', () => {
  const driver = randomUUID();
  const staff = randomUUID();
  const depotStaff: AuthenticatedUser = {
    sub: 'staff-1',
    role: 'KEPALA_DEPOT' as never,
    phone: '08',
    depotId: DEPOT,
  };
  let repo: InMemoryDeliveryRepository;
  let service: DeliveryService;

  beforeEach(async () => {
    repo = new InMemoryDeliveryRepository();
    const config = buildTestConfig({ NO_SHOW_MIN_CONTACT_ATTEMPTS: '2' });
    const depots = new FakeDepotLocation();
    const shifts = new ShiftService(new InMemoryShiftRepository(), repo, depots, config);
    service = new DeliveryService(
      repo,
      new FakeOrderCoordination(),
      new FakeCourierPayout(),
      shifts,
      config,
      depots,
      new FakeOrderPayment(),
      new FakeOrderLookup(),
    );
    await shifts.checkIn(driver, DEPOT, AT_DEPOT.lat, AT_DEPOT.lng);
  });

  const assign = () =>
    service.assign(
      staff,
      {
        orderId: randomUUID(),
        orderNumber: 'HM-1',
        driverId: driver,
        depotId: DEPOT,
        destinationAddress: 'Jl. Merdeka 10',
      },
      AUTH,
    );

  describe('fail', () => {
    it('a reasonCode stores the code and shows its label', async () => {
      const d = await assign();
      const out = await service.fail(driver, d.id, undefined, AUTH, false, 'CUSTOMER_REFUSED');
      expect(out.failureReasonCode).toBe('CUSTOMER_REFUSED');
      expect(out.failureReason).toBe('Pelanggan menolak');
    });

    it('a note is appended to the label', async () => {
      const d = await assign();
      const out = await service.fail(driver, d.id, undefined, AUTH, false, 'OTHER', 'Rumah kosong');
      expect(out.failureReasonCode).toBe('OTHER');
      expect(out.failureReason).toBe('Lainnya: Rumah kosong');
    });

    it('a blank note is treated as absent and a note is trimmed', async () => {
      const d = await assign();
      expect((await service.fail(driver, d.id, undefined, AUTH, false, 'OTHER', '   ')).failureReason).toBe('Lainnya');
      const e = await assign();
      expect((await service.fail(driver, e.id, undefined, AUTH, false, 'OTHER', ' ramai ')).failureReason).toBe('Lainnya: ramai');
    });

    it('the response carries failureReasonCode', async () => {
      const d = await assign();
      const out = await service.fail(driver, d.id, undefined, AUTH, false, 'GOODS_DAMAGED');
      expect(out).toMatchObject({ failureReason: 'Barang rusak', failureReasonCode: 'GOODS_DAMAGED' });
    });

    it('the old text alone keeps working and is classified', async () => {
      const d = await assign();
      const out = await service.fail(driver, d.id, 'Barang rusak', AUTH);
      expect(out.failureReason).toBe('Barang rusak');
      expect(out.failureReasonCode).toBe('GOODS_DAMAGED');
      const e = await assign();
      expect((await service.fail(driver, e.id, 'telp 0812 tidak aktif', AUTH)).failureReasonCode).toBe(
        'OTHER',
      );
    });

    it('the code wins when both come', async () => {
      const d = await assign();
      const out = await service.fail(driver, d.id, 'free text', AUTH, false, 'ADDRESS_NOT_FOUND');
      expect(out.failureReasonCode).toBe('ADDRESS_NOT_FOUND');
      expect(out.failureReason).toBe('Alamat tidak ditemukan');
    });

    it('neither is a 400', async () => {
      const d = await assign();
      await expect(service.fail(driver, d.id, undefined, AUTH)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('a replay does not change the stored code', async () => {
      const d = await assign();
      await service.fail(driver, d.id, undefined, AUTH, false, 'CUSTOMER_REFUSED');
      const again = await service.fail(driver, d.id, undefined, AUTH, false, 'GOODS_DAMAGED');
      expect(again.failureReasonCode).toBe('CUSTOMER_REFUSED');
    });

    it('the no-show route stores NO_SHOW', async () => {
      const d = await assign();
      await service.recordContactAttempt(driver, d.id, ContactMethod.CALL);
      const s = await service.recordContactAttempt(driver, d.id, ContactMethod.WHATSAPP);
      const out = await service.markNoShow(driver, d.id, s.eligibleAt!, AUTH);
      expect(out.failureReasonCode).toBe('NO_SHOW');
      expect(out.failureReason).toBe(NO_SHOW_REASON);
    });

    it('the staff cancel stores DEPOT_CANCELLED and keeps the typed text', async () => {
      const d = await assign();
      const out = await service.cancelByStaff(depotStaff, d.id, 'Pelanggan batal', AUTH);
      expect(out.failureReasonCode).toBe('DEPOT_CANCELLED');
      expect(out.failureReason).toBe('Pelanggan batal');
    });

    it('a cash reversal that fails puts the code back to null with the text', async () => {
      const d = await assign();
      const stored = repo.rows.find((r) => r.id === d.id)!;
      jest
        .spyOn(service as never, 'settleHeldCash' as never)
        .mockRejectedValueOnce(new Error('boom') as never);
      await expect(
        service.fail(driver, d.id, undefined, AUTH, true, 'CANNOT_CONTACT'),
      ).rejects.toThrow('boom');
      expect(stored.failureReasonCode).toBeNull();
      expect(stored.failureReason).toBeNull();
    });
  });

  describe('reschedule', () => {
    const future = () => new Date(Date.now() + 3_600_000);

    it('the controller maps CUSTOMER_REQUEST, COURIER_ISSUE and absent', async () => {
      const reschedule = jest.fn().mockResolvedValue({});
      const controller = new DriverDeliveryController({ reschedule } as never);
      const user = { sub: driver } as AuthenticatedUser;
      const when = future().toISOString();
      for (const reason of ['CUSTOMER_REQUEST', 'COURIER_ISSUE', undefined] as const) {
        await controller.reschedule(
          user,
          randomUUID(),
          { rescheduledFor: when, reason } as never,
          AUTH,
        );
      }
      expect(reschedule.mock.calls.map((c) => c[2].initiator)).toEqual([
        'CUSTOMER',
        'COURIER',
        'CUSTOMER',
      ]);
      expect(initiatorOf(undefined)).toBe('CUSTOMER');
    });

    it('a COURIER reschedule is stored as such and the re-open does not restart the clock', async () => {
      const d = await assign();
      const out = await service.reschedule(driver, d.id, {
        rescheduledFor: future(),
        initiator: 'COURIER',
      });
      expect(out.rescheduleInitiator).toBe('COURIER');
      await repo.reassignIfUnderCap(d.id, driver, staff, null, 5);
      expect(repo.rows.find((r) => r.id === d.id)!.slaStartedAt).toBeNull();
    });
  });

  describe('DTOs', () => {
    const errs = (cls: new () => object, body: object) => validate(plainToInstance(cls, body));

    it('fail: old body, code only, code + note pass; unknown code, empty reason, long note fail', async () => {
      expect(await errs(FailDeliveryDto, { reason: 'Barang rusak' })).toHaveLength(0);
      expect(await errs(FailDeliveryDto, { reasonCode: 'OTHER' })).toHaveLength(0);
      expect(
        await errs(FailDeliveryDto, { reasonCode: 'OTHER', note: 'x', cashReturned: true }),
      ).toHaveLength(0);
      expect(await errs(FailDeliveryDto, { reasonCode: 'NO_SHOW' })).not.toHaveLength(0);
      expect(await errs(FailDeliveryDto, { reasonCode: 'NOPE' })).not.toHaveLength(0);
      expect(await errs(FailDeliveryDto, { reason: '' })).not.toHaveLength(0);
      expect(
        await errs(FailDeliveryDto, { reasonCode: 'OTHER', note: 'x'.repeat(256) }),
      ).not.toHaveLength(0);
    });

    it('reschedule: old body and both reasons pass, an unknown one fails', async () => {
      const base = { rescheduledFor: '2026-12-01T03:00:00.000Z' };
      expect(await errs(RescheduleDeliveryDto, base)).toHaveLength(0);
      expect(await errs(RescheduleDeliveryDto, { ...base, reason: 'CUSTOMER_REQUEST' })).toHaveLength(0);
      expect(await errs(RescheduleDeliveryDto, { ...base, reason: 'COURIER_ISSUE' })).toHaveLength(0);
      expect(await errs(RescheduleDeliveryDto, { ...base, reason: 'DEPOT' })).not.toHaveLength(0);
    });
  });
});
