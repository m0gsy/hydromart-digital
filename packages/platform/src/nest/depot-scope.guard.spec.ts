import { ExecutionContext, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { Role } from '../domain/role.enum';
import { DepotScopeGuard } from './depot-scope.guard';
import { configureDepotScope, resetDepotScope } from './depot-scope-resolver';

const DEPOT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DEPOT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const DEPOT_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function ctx(
  user: unknown,
  req: { query?: unknown; body?: unknown; params?: unknown } = {},
  isPublic = false,
): { context: ExecutionContext; reflector: Reflector; request: { user: unknown } } {
  const reflector = { getAllAndOverride: () => isPublic } as unknown as Reflector;
  const request = { user, query: req.query ?? {}, body: req.body ?? {}, params: req.params ?? {} };
  const context = {
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, reflector, request };
}

afterEach(() => resetDepotScope());

describe('DepotScopeGuard', () => {
  const run = (
    user: unknown,
    req: Parameters<typeof ctx>[1] = {},
    isPublic = false,
  ): Promise<boolean> => {
    const { context, reflector } = ctx(user, req, isPublic);
    return new DepotScopeGuard(reflector).canActivate(context);
  };

  describe('single-depot roles read the token, with no lookup', () => {
    it('allows a depot head querying their OWN depot', async () => {
      await expect(
        run({ role: Role.KEPALA_DEPOT, depotId: DEPOT_A }, { query: { depotId: DEPOT_A } }),
      ).resolves.toBe(true);
    });

    it('forbids a depot head querying ANOTHER depot', async () => {
      await expect(
        run({ role: Role.KEPALA_DEPOT, depotId: DEPOT_A }, { query: { depotId: DEPOT_B } }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('forbids depot staff with no assigned depot from any depot query', async () => {
      await expect(
        run({ role: Role.STAFF_DEPOT, depotId: null }, { body: { depotId: DEPOT_A } }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('reads depotId from route params too (path-scoped endpoints)', async () => {
      await expect(
        run({ role: Role.KEPALA_DEPOT, depotId: DEPOT_A }, { params: { depotId: DEPOT_B } }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // AUTHZ-A2: the guard used to stop at the FIRST depotId it found (query, then body, then
  // params), so any `:depotId` route could be waved through by pinning an own-depot
  // `?depotId=` next to it. Every value the request carries has to clear the check, because
  // the handler is free to read any one of them.
  describe('every depotId the request carries must clear the check', () => {
    it('forbids an own-depot query pinned onto another depot route param', async () => {
      await expect(
        run(
          { role: Role.KEPALA_DEPOT, depotId: DEPOT_A },
          { query: { depotId: DEPOT_A }, params: { depotId: DEPOT_B } },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('forbids an own-depot query pinned onto another depot body field', async () => {
      await expect(
        run(
          { role: Role.KEPALA_DEPOT, depotId: DEPOT_A },
          { query: { depotId: DEPOT_A }, body: { depotId: DEPOT_B } },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('forbids an own-depot body field pinned onto another depot route param', async () => {
      await expect(
        run(
          { role: Role.KEPALA_DEPOT, depotId: DEPOT_A },
          { body: { depotId: DEPOT_A }, params: { depotId: DEPOT_B } },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    // express parses a repeated key into an array, which the old string-only read skipped
    // entirely — so `?depotId=A&depotId=B` reached the handler unchecked.
    it('checks every value of a repeated query key', async () => {
      await expect(
        run(
          { role: Role.KEPALA_DEPOT, depotId: DEPOT_A },
          { query: { depotId: [DEPOT_A, DEPOT_B] } },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        run(
          { role: Role.KEPALA_DEPOT, depotId: DEPOT_A },
          { query: { depotId: [DEPOT_A, DEPOT_A] } },
        ),
      ).resolves.toBe(true);
    });

    it('still allows the same own depot repeated across all three sources', async () => {
      await expect(
        run(
          { role: Role.KEPALA_DEPOT, depotId: DEPOT_A },
          {
            query: { depotId: DEPOT_A },
            body: { depotId: DEPOT_A },
            params: { depotId: DEPOT_A },
          },
        ),
      ).resolves.toBe(true);
    });

    // `?depotIds=a,b` is the batch form the owner dashboard uses (inventory low-stock). The
    // guard only knew the singular key, so the batch one was an unchecked selector.
    it('checks the comma-separated depotIds batch key too', async () => {
      await expect(
        run(
          { role: Role.KEPALA_DEPOT, depotId: DEPOT_A },
          { query: { depotIds: `${DEPOT_A},${DEPOT_B}` } },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        run({ role: Role.KEPALA_DEPOT, depotId: DEPOT_A }, { query: { depotIds: DEPOT_A } }),
      ).resolves.toBe(true);
      await expect(
        run({ role: Role.KEPALA_DEPOT, depotId: DEPOT_A }, { query: { depotIds: '' } }),
      ).resolves.toBe(true);
    });

    it('ignores non-string depotId shapes rather than trusting them', async () => {
      await expect(
        run({ role: Role.KEPALA_DEPOT, depotId: DEPOT_A }, { body: { depotId: { id: DEPOT_B } } }),
      ).resolves.toBe(true);
    });
  });

  describe('multi-depot roles resolve a set', () => {
    it('lets a supervisor reach any depot in their set and refuses the rest', async () => {
      configureDepotScope(async () => [DEPOT_A, DEPOT_B]);
      await expect(
        run({ role: Role.SUPERVISOR, sub: 'spv-1' }, { query: { depotId: DEPOT_B } }),
      ).resolves.toBe(true);
      await expect(
        run({ role: Role.SUPERVISOR, sub: 'spv-1' }, { query: { depotId: DEPOT_C } }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('stashes the resolved set on the request identity for the handlers downstream', async () => {
      configureDepotScope(async () => [DEPOT_A, DEPOT_B]);
      const { context, reflector, request } = ctx({ role: Role.MANAGER, sub: 'mgr-1' });
      await new DepotScopeGuard(reflector).canActivate(context);
      expect((request.user as { depotIds: string[] }).depotIds).toEqual([DEPOT_A, DEPOT_B]);
    });

    it('resolves once per request when the set is already present', async () => {
      const resolver = jest.fn().mockResolvedValue([DEPOT_A]);
      configureDepotScope(resolver);
      await run({ role: Role.SUPERVISOR, sub: 'spv-1', depotIds: [DEPOT_A] });
      expect(resolver).not.toHaveBeenCalled();
    });

    it('refuses a supervisor with nothing assigned', async () => {
      configureDepotScope(async () => []);
      await expect(
        run({ role: Role.ASSISTANT_SUPERVISOR, sub: 'asv-1' }, { query: { depotId: DEPOT_A } }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    // Fails CLOSED, unlike the capability matrix: an empty set denies anyway and a
    // wildcard would be a tenant-isolation breach, so there is no safe default to fall
    // back to when depot-service cannot be reached.
    it('503s rather than guessing when the lookup fails and the caller has no own depot', async () => {
      configureDepotScope(async () => {
        throw new Error('depot-service down');
      });
      await expect(
        run({ role: Role.SUPERVISOR, sub: 'spv-1' }, { query: { depotId: DEPOT_A } }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    // Narrowing is safe (it denies, never grants), so a caller who has a depot of their own
    // keeps working on it through an outage instead of being locked out of everything.
    it('falls back to the own depot when the lookup fails', async () => {
      configureDepotScope(async () => {
        throw new Error('depot-service down');
      });
      await expect(
        run(
          { role: Role.MANAGER, sub: 'mgr-1', depotId: DEPOT_A },
          { query: { depotId: DEPOT_A } },
        ),
      ).resolves.toBe(true);
      await expect(
        run(
          { role: Role.MANAGER, sub: 'mgr-2', depotId: DEPOT_A },
          { query: { depotId: DEPOT_B } },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    // An UNCONFIGURED resolver is a wiring mistake, not an outage: there is no hierarchy to
    // consult, so the caller gets their own depot rather than a 503 on every request.
    it('treats a missing resolver as "no hierarchy known", not an outage', async () => {
      await expect(
        run(
          { role: Role.MANAGER, sub: 'mgr-1', depotId: DEPOT_A },
          { query: { depotId: DEPOT_A } },
        ),
      ).resolves.toBe(true);
      await expect(
        run(
          { role: Role.MANAGER, sub: 'mgr-1', depotId: DEPOT_A },
          { query: { depotId: DEPOT_C } },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('unions the own depot with the resolved set', async () => {
      configureDepotScope(async () => [DEPOT_B]);
      const { context, reflector, request } = ctx({
        role: Role.MANAGER,
        sub: 'mgr-1',
        depotId: DEPOT_A,
      });
      await new DepotScopeGuard(reflector).canActivate(context);
      expect((request.user as { depotIds: string[] }).depotIds.sort()).toEqual(
        [DEPOT_A, DEPOT_B].sort(),
      );
    });
  });

  it('lets bypass roles read any depot', async () => {
    for (const role of [
      Role.HEAD_OFFICE,
      Role.SUPER_ADMIN,
      Role.FINANCE,
      Role.MARKETING,
      Role.DIREKTUR,
    ]) {
      await expect(run({ role, depotId: null }, { query: { depotId: DEPOT_B } })).resolves.toBe(
        true,
      );
    }
  });

  it('allows a scoped role on requests that carry no depotId (by-id paths guarded in-service)', async () => {
    await expect(
      run({ role: Role.KEPALA_DEPOT, depotId: DEPOT_A }, { params: { id: 'x' } }),
    ).resolves.toBe(true);
  });

  it('skips public routes and missing identity', async () => {
    await expect(
      run({ role: Role.KEPALA_DEPOT, depotId: DEPOT_A }, { query: { depotId: DEPOT_B } }, true),
    ).resolves.toBe(true);
    await expect(run(undefined, { query: { depotId: DEPOT_B } })).resolves.toBe(true);
  });
});
