import { plainToInstance } from 'class-transformer';

import { DepotController } from '../../src/modules/depot.controller';
import { SupplierController } from '../../src/modules/supplier.controller';
import { WholesaleTierController } from '../../src/modules/wholesale-tier.controller';
import { UpdateDepotDto } from '../../src/modules/dto/depot.dto';
import { UpdateSupplierDto } from '../../src/modules/dto/procurement.dto';
import { UpdateWholesaleTierDto } from '../../src/modules/dto/wholesale-tier.dto';

/*
 * `seenUpdatedAt` is the version the client read — the token of the freshness check (CA-2-53) — and
 * not a column. Every one of these controllers passed the WHOLE dto on as the patch, so the stamp
 * travelled with it into `prisma.update({ data })` and Prisma refused it ("Unknown argument
 * `seenUpdatedAt`"): the save answered 500 for every console form that sends the stamp, which is
 * every form CA-2-53 touched. The unit tests use in-memory repositories, which accept any object,
 * so nothing but a real database could say so; the UAT run did.
 *
 * What is pinned here is the boundary: the service gets the stamp as its OWN argument and a patch
 * that does not contain it.
 */
const SEEN = '2026-09-26T06:14:13.241Z';
const DEPOT = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const user = { sub: 'u', role: 'SUPER_ADMIN', depotId: null } as never;

describe('the freshness stamp does not reach the patch', () => {
  it('depot', async () => {
    const svc = { update: jest.fn().mockResolvedValue({}) };
    const dto = plainToInstance(UpdateDepotDto, { ownerId: ID, seenUpdatedAt: SEEN });
    await new DepotController(svc as never, {} as never).update(ID, dto);
    const [, patch, seen] = svc.update.mock.calls[0];
    expect(seen).toBe(SEEN);
    expect(patch).not.toHaveProperty('seenUpdatedAt');
    expect(patch).toMatchObject({ ownerId: ID });
  });

  it('supplier', async () => {
    const svc = { get: jest.fn().mockResolvedValue({ depotId: DEPOT }), update: jest.fn().mockResolvedValue({}) };
    const dto = plainToInstance(UpdateSupplierDto, { name: 'CV Air', seenUpdatedAt: SEEN });
    await new SupplierController(svc as never).update(ID, dto, user);
    const [, patch, seen] = svc.update.mock.calls[0];
    expect(seen).toBe(SEEN);
    expect(patch).not.toHaveProperty('seenUpdatedAt');
    expect(patch).toMatchObject({ name: 'CV Air' });
  });

  it('wholesale tier', async () => {
    const svc = { get: jest.fn().mockResolvedValue({ depotId: DEPOT }), update: jest.fn().mockResolvedValue({}) };
    const dto = plainToInstance(UpdateWholesaleTierDto, { priceIdr: 6000, seenUpdatedAt: SEEN });
    await new WholesaleTierController(svc as never).update(ID, dto, user);
    const [, patch, seen] = svc.update.mock.calls[0];
    expect(seen).toBe(SEEN);
    expect(patch).not.toHaveProperty('seenUpdatedAt');
    expect(patch).toMatchObject({ priceIdr: 6000 });
  });
});
