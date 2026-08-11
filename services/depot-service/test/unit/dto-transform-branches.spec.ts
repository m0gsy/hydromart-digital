import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  BrowseDepotsQueryDto,
  CreateDepotDto,
  NearbyDepotsQueryDto,
} from '../../src/modules/dto/depot.dto';
import { ListApplicationsQueryDto } from '../../src/modules/dto/franchise-application.dto';
import { CreateGallonIssueDto, ListIssuesQueryDto } from '../../src/modules/dto/gallon-issue.dto';
import {
  CreateCourierReturnDto,
  CreateGallonReturnDto,
  ListReturnsQueryDto,
} from '../../src/modules/dto/gallon-return.dto';
import { CreateHandoverDto } from '../../src/modules/dto/handover.dto';
import { UpsertHuddleNoteDto } from '../../src/modules/dto/huddle.dto';
import {
  ListPriceOverridesQueryDto,
  ProposePriceOverrideDto,
} from '../../src/modules/dto/price-override.dto';
import { CreatePurchaseOrderDto, CreateSupplierDto } from '../../src/modules/dto/procurement.dto';
import { BulkRosterDto, IsMondayConstraint } from '../../src/modules/dto/roster.dto';

// Runs the @Type(() => Number/Nested) transform arrows in each DTO (never triggered by a bare
// import) so string query/body values are coerced. class-transformer only invokes an arrow for
// a field present in the plain object, so each field a getter/nested class relies on is supplied.

describe('DTO @Type transforms coerce query and nested values', () => {
  it('coerces number query fields', () => {
    expect(plainToInstance(BrowseDepotsQueryDto, { page: '2', limit: '20' })).toMatchObject({
      page: 2,
      limit: 20,
    });
    expect(
      plainToInstance(NearbyDepotsQueryDto, { lat: '-6.1', lng: '106.8', limit: '5' }),
    ).toMatchObject({ lat: -6.1, lng: 106.8, limit: 5 });
    expect(plainToInstance(ListApplicationsQueryDto, { page: '3', limit: '10' })).toMatchObject({
      page: 3,
      limit: 10,
    });
    expect(plainToInstance(ListIssuesQueryDto, { page: '1', limit: '20' })).toMatchObject({
      page: 1,
      limit: 20,
    });
    expect(plainToInstance(ListReturnsQueryDto, { page: '1', limit: '20' })).toMatchObject({
      page: 1,
      limit: 20,
    });
    expect(plainToInstance(ListPriceOverridesQueryDto, { page: '1', limit: '20' })).toMatchObject({
      page: 1,
      limit: 20,
    });
  });

  it('coerces number body fields', () => {
    expect(
      plainToInstance(CreateDepotDto, {
        lat: '-6.1',
        lng: '106.8',
        serviceRadiusKm: '5',
        deliveryFee: '5000',
        minOrderAmount: '1000',
      }),
    ).toMatchObject({ lat: -6.1, deliveryFee: 5000, minOrderAmount: 1000 });
    expect(
      plainToInstance(CreateGallonIssueDto, { quantity: '3', depositHeld: '15000' }),
    ).toMatchObject({ quantity: 3, depositHeld: 15000 });
    expect(
      plainToInstance(CreateGallonReturnDto, { quantity: '3', depositRefunded: '15000' }),
    ).toMatchObject({ quantity: 3, depositRefunded: 15000 });
    expect(plainToInstance(CreateCourierReturnDto, { quantity: '3' })).toMatchObject({
      quantity: 3,
    });
    expect(
      plainToInstance(ProposePriceOverrideDto, { currentPrice: '1000', value: '200' }),
    ).toMatchObject({ currentPrice: 1000, value: 200 });
    expect(plainToInstance(CreateSupplierDto, { onTimeRate: '90' })).toMatchObject({
      onTimeRate: 90,
    });
  });

  it('coerces nested collection items to their DTO classes', () => {
    const handover = plainToInstance(CreateHandoverDto, {
      items: [{ title: 't', subtext: 's', state: 'OK' }],
    });
    expect(handover.items[0]).toMatchObject({ title: 't' });

    const huddle = plainToInstance(UpsertHuddleNoteDto, {
      agenda: [{ title: 'a', note: 'n' }],
      actionItems: [{ text: 't', assignee: 'x', done: false }],
    });
    expect(huddle.agenda[0]).toMatchObject({ title: 'a' });
    expect(huddle.actionItems[0]).toMatchObject({ text: 't' });

    const po = plainToInstance(CreatePurchaseOrderDto, {
      lines: [{ itemType: 'PRODUK', label: 'l', quantity: 2, unitCostIdr: 4500 }],
    });
    expect(po.lines[0]).toMatchObject({ label: 'l' });

    const roster = plainToInstance(BulkRosterDto, {
      cells: [{ staffId: 's', staffName: 'n', day: 0, shift: 'MORNING' }],
    });
    expect(roster.cells[0]).toMatchObject({ staffId: 's' });
  });
});

/*
 * B5. The unique key is `(depotId, weekStart, staffId, day)` on this string as typed, so a
 * Wednesday stores the same week a second time as a parallel grid — and the days off
 * already filled in "disappear", because they are being read under a different week key.
 */
describe('roster weekStart must be a Monday', () => {
  const isMonday = (value: unknown) => new IsMondayConstraint().validate(value);

  it('accepts a Monday', () => {
    expect(isMonday('2026-07-13')).toBe(true); // Monday
    expect(isMonday('2026-08-03')).toBe(true); // Monday
  });

  it('refuses every other day of the week, including the day either side', () => {
    expect(isMonday('2026-07-12')).toBe(false); // Sunday
    expect(isMonday('2026-07-14')).toBe(false); // Tuesday
    expect(isMonday('2026-07-15')).toBe(false); // Wednesday
    expect(isMonday('2026-07-19')).toBe(false); // Sunday
  });

  it('refuses anything that is not a plain YYYY-MM-DD date', () => {
    expect(isMonday('2026-07-13T00:00:00.000Z')).toBe(false);
    expect(isMonday('13-07-2026')).toBe(false);
    expect(isMonday('2026-13-45')).toBe(false);
    expect(isMonday('')).toBe(false);
    expect(isMonday(undefined)).toBe(false);
    expect(isMonday(20260713)).toBe(false);
  });

  it('carries a message that names Monday, so the caller can fix it', () => {
    expect(new IsMondayConstraint().defaultMessage()).toContain('Monday');
  });
});

// SOP §3. crm-service's SendNotificationDto enforces this exact pattern on the number it
// messages, and order-service's notification adapter is fail-open — it logs a 400 and
// returns. A dashed number accepted here would mean the depot silently never receives its
// sales report, so the rule is enforced where an operator types it.
describe('CreateDepotDto.contactPhone matches crm-service phone validation', () => {
  const check = async (contactPhone: unknown): Promise<string[]> => {
    const errors = await validate(plainToInstance(CreateDepotDto, { contactPhone }), {
      skipMissingProperties: true,
    });
    return errors.filter((e) => e.property === 'contactPhone').map((e) => e.property);
  };

  it('accepts a plain and a +-prefixed number', async () => {
    expect(await check('081234567890')).toEqual([]);
    expect(await check('+6281234567890')).toEqual([]);
  });

  it('accepts it being absent — a depot may have no number of its own', async () => {
    expect(await check(undefined)).toEqual([]);
  });

  it('rejects separators, a too-short number, and free text', async () => {
    expect(await check('0812-3456-7890')).toEqual(['contactPhone']);
    expect(await check('+62 812 3456 7890')).toEqual(['contactPhone']);
    expect(await check('0812')).toEqual(['contactPhone']);
    expect(await check('telp depot')).toEqual(['contactPhone']);
  });
});
