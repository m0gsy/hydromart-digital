import { ForbiddenException } from '@nestjs/common';

import { Role } from '../domain/role.enum';
import { assertDepotOwnership } from './depot-scope';

const OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('assertDepotOwnership', () => {
  it('lets a franchise owner act on a depot they own', () => {
    expect(() => assertDepotOwnership({ role: Role.FRANCHISE_OWNER, sub: OWNER }, OWNER)).not.toThrow();
  });

  it("forbids a franchise owner acting on someone else's depot", () => {
    expect(() => assertDepotOwnership({ role: Role.FRANCHISE_OWNER, sub: OWNER }, OTHER)).toThrow(
      ForbiddenException,
    );
  });

  it('fails closed when the depot has no recorded owner', () => {
    expect(() => assertDepotOwnership({ role: Role.FRANCHISE_OWNER, sub: OWNER }, null)).toThrow(
      ForbiddenException,
    );
  });

  it('is a no-op for every other role and the missing user', () => {
    expect(() => assertDepotOwnership({ role: Role.HEAD_OFFICE, sub: OTHER }, OWNER)).not.toThrow();
    expect(() => assertDepotOwnership({ role: Role.DEPOT_MANAGER, sub: OTHER }, OWNER)).not.toThrow();
    expect(() => assertDepotOwnership(undefined, OWNER)).not.toThrow();
  });
});
