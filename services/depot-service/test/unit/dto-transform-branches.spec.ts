import { plainToInstance } from 'class-transformer';

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
import { BulkRosterDto } from '../../src/modules/dto/roster.dto';

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
