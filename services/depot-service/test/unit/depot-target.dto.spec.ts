import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { DepotTargetsByMonthQueryDto, UpsertDepotTargetDto } from '../../src/modules/dto/depot-target.dto';

const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const props = <T extends object>(cls: new () => T, body: object) =>
  validateSync(plainToInstance(cls, body)).map((e) => e.property);

describe('depot target DTOs (HD-16)', () => {
  const base = { depotId: D1, month: '2026-11', revenueTargetIdr: 1, ordersTarget: 1, slaTargetPct: 96, newCustomersTarget: 1 };

  it('the PUT takes a gallons target as a non-negative whole number, up to int4', () => {
    expect(props(UpsertDepotTargetDto, { ...base, gallonsTarget: 3000 })).toEqual([]);
    expect(props(UpsertDepotTargetDto, { ...base, gallonsTarget: 0 })).toEqual([]);
    expect(props(UpsertDepotTargetDto, base)).toContain('gallonsTarget');
    expect(props(UpsertDepotTargetDto, { ...base, gallonsTarget: -1 })).toContain('gallonsTarget');
    expect(props(UpsertDepotTargetDto, { ...base, gallonsTarget: 1.5 })).toContain('gallonsTarget');
    expect(props(UpsertDepotTargetDto, { ...base, gallonsTarget: 2_147_483_648 })).toContain('gallonsTarget');
  });

  it('the internal month read takes 1 to 100 depot ids and a YYYY-MM month', () => {
    expect(props(DepotTargetsByMonthQueryDto, { depotIds: `${D1}, ${D2}`, month: '2026-11' })).toEqual([]);
    expect(props(DepotTargetsByMonthQueryDto, { depotIds: '', month: '2026-11' })).toContain('depotIds');
    expect(props(DepotTargetsByMonthQueryDto, { depotIds: 'nope', month: '2026-11' })).toContain('depotIds');
    expect(props(DepotTargetsByMonthQueryDto, { depotIds: Array(101).fill(D1).join(','), month: '2026-11' })).toContain('depotIds');
    expect(props(DepotTargetsByMonthQueryDto, { depotIds: D1, month: '2026-13' })).toContain('month');
    expect(props(DepotTargetsByMonthQueryDto, { depotIds: 7, month: '2026-11' })).toContain('depotIds');
  });
});
