import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  AssignDeliveryDto,
  ListDeliveriesQueryDto,
  ProofOfDeliveryDto,
  RecordContactAttemptDto,
  ReportLocationDto,
  RescheduleDeliveryDto,
} from '../../src/modules/dto/delivery.dto';
import { ReportIncidentDto } from '../../src/modules/dto/incident.dto';
import { SlaReportQueryDto } from '../../src/modules/dto/report.dto';
import { DeliveryStatus } from '../../src/domain/delivery-status';
import { ContactMethod } from '../../src/domain/no-show';
import { IncidentCategory, IncidentSeverity } from '../../src/domain/incident';

/**
 * Gap-fill: runs the request DTOs through class-transformer so the `@Type(() => …)`
 * and `@Transform` factory functions actually execute (they never run at import time,
 * only during transformation). Validation is asserted to keep the coercions honest.
 */
describe('delivery DTO transforms', () => {
  it('coerces the numeric ReportLocationDto lat/lng from strings', async () => {
    const dto = plainToInstance(ReportLocationDto, { lat: '-6.2088', lng: '106.8456' });
    expect(dto.lat).toBe(-6.2088);
    expect(dto.lng).toBe(106.8456);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('coerces the nested items + codAmount on AssignDeliveryDto', async () => {
    const dto = plainToInstance(AssignDeliveryDto, {
      orderId: '00000000-0000-4000-8000-000000000001',
      orderNumber: 'HM-1',
      driverId: '00000000-0000-4000-8000-000000000002',
      destinationAddress: 'Jl. Merdeka 10',
      codAmount: '84000',
      items: [{ name: 'Galon 19L', qty: '2' }],
    });
    expect(dto.codAmount).toBe(84000);
    expect(dto.items?.[0]).toMatchObject({ name: 'Galon 19L', qty: 2 });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a full proof-of-delivery payload', async () => {
    const dto = plainToInstance(ProofOfDeliveryDto, {
      photoUrl: 'http://x/pod.png',
      recipientName: 'Budi',
      latitude: -6.9147,
      longitude: 107.6098,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('coerces paging numbers on ListDeliveriesQueryDto', async () => {
    const dto = plainToInstance(ListDeliveriesQueryDto, {
      status: DeliveryStatus.ASSIGNED,
      page: '2',
      limit: '50',
    });
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(50);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('keeps the optional contact method / reschedule payload valid', async () => {
    const contact = plainToInstance(RecordContactAttemptDto, { method: ContactMethod.CALL });
    expect(await validate(contact)).toHaveLength(0);
    const reschedule = plainToInstance(RescheduleDeliveryDto, {
      rescheduledFor: '2026-08-01T09:00:00.000Z',
      slot: 'Sore',
    });
    expect(await validate(reschedule)).toHaveLength(0);
  });

  it('coerces incident lat/lng and validates the enums', async () => {
    const dto = plainToInstance(ReportIncidentDto, {
      category: IncidentCategory.ACCIDENT,
      severity: IncidentSeverity.HIGH,
      description: 'Ban bocor',
      lat: '-6.9147',
      lng: '107.6098',
    });
    expect(dto.lat).toBe(-6.9147);
    expect(dto.lng).toBe(107.6098);
    expect(await validate(dto)).toHaveLength(0);
  });
});

describe('SlaReportQueryDto.depotIds transform', () => {
  it('splits a comma string into trimmed non-empty uuids', async () => {
    const a = '00000000-0000-4000-8000-000000000001';
    const b = '00000000-0000-4000-8000-000000000002';
    const dto = plainToInstance(SlaReportQueryDto, {
      depotIds: `${a}, ${b} , `,
      thresholdMinutes: '90',
    });
    expect(dto.depotIds).toEqual([a, b]);
    expect(dto.thresholdMinutes).toBe(90);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('passes a non-string depotIds value through untouched', () => {
    const dto = plainToInstance(SlaReportQueryDto, { depotIds: ['not-a-uuid'] });
    expect(dto.depotIds).toEqual(['not-a-uuid']);
  });
});

/*
 * CA-2-29. The tracking board asks for a SET of statuses now, and it arrives as a query
 * string — so the comma-splitting transform is the only thing between the URL and the
 * repository filter.
 */
describe('ListDeliveriesQueryDto.statuses transform', () => {
  it('splits a comma string into trimmed non-empty statuses', async () => {
    const dto = plainToInstance(ListDeliveriesQueryDto, {
      statuses: 'ASSIGNED, PICKED_UP , ',
    });
    expect(dto.statuses).toEqual([DeliveryStatus.ASSIGNED, DeliveryStatus.PICKED_UP]);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('passes a non-string statuses value through untouched', () => {
    const dto = plainToInstance(ListDeliveriesQueryDto, { statuses: [DeliveryStatus.FAILED] });
    expect(dto.statuses).toEqual([DeliveryStatus.FAILED]);
  });

  it('rejects a status that is not one of the six', async () => {
    const dto = plainToInstance(ListDeliveriesQueryDto, { statuses: 'ASSIGNED,NOT_A_STATUS' });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
