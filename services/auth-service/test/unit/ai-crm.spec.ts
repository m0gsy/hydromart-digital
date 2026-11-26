import { generateKeyPairSync } from 'node:crypto';

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AccountService } from '../../src/application/services/account.service';
import { AuditService } from '../../src/application/services/audit.service';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
import { Role } from '../../src/domain/customer/role.enum';
import { ExternalTokenSigner } from '../../src/infrastructure/security/external-token-signer';
import { AiCrmController, AiTokenOnlyGuard } from '../../src/modules/auth/ai-crm.controller';
import {
  InMemoryAuditLogRepository,
  InMemoryCustomerRepository,
  buildTestConfig,
  makeCustomer,
} from '../support/fakes';

const keyB64 = () =>
  generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const NOW = new Date();
const config = buildTestConfig();

const ctx = (headers: Record<string, string>, extra: Record<string, unknown> = {}) => {
  const request = { headers, ...extra };
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => 'handler',
      getClass: () => 'class',
    } as never,
  };
};

describe('JwtAuthGuard: AI and machine tokens (HD-21)', () => {
  const signer = new ExternalTokenSigner(buildTestConfig({ AI_TOKEN_SIGNING_KEY: keyB64(), AI_TOKEN_SIGNING_KEY_PREVIOUS: keyB64() }));
  const reflector = (answers: { isPublic?: boolean; external?: string[] }) =>
    ({
      getAllAndOverride: (key: string) => (key === 'externalAccess' ? answers.external : answers.isPublic),
    }) as unknown as Reflector;
  const guard = (answers: { isPublic?: boolean; external?: string[] }, s: ExternalTokenSigner | null = signer) =>
    new JwtAuthGuard(reflector(answers), { verifyAsync: jest.fn() } as never, config, s ?? undefined);
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  it('admits a verified AI token on a route that says @ExternalAccess(ai), as the person it names', async () => {
    const token = signer.sign({ aud: 'hydromart-ai', sub: 'p1', role: 'MARKETING', depotId: 'd1' }, 600, NOW);
    const { context, request } = ctx(bearer(token));
    await expect(guard({ external: ['ai'] }).canActivate(context)).resolves.toBe(true);
    expect(request).toMatchObject({ user: { sub: 'p1', role: 'MARKETING', via: 'ai', depotId: 'd1' } });
  });

  it('admits a machine token only where machine is allowed, with its scopes and no role', async () => {
    const token = signer.sign({ aud: 'hydromart-machine', sub: 'm1', scopes: ['a'] }, 600, NOW);
    const { context, request } = ctx(bearer(token));
    await expect(guard({ external: ['machine'] }).canActivate(context)).resolves.toBe(true);
    expect(request).toMatchObject({ user: { via: 'machine', scopes: ['a'], role: 'MACHINE' } });
    await expect(guard({ external: ['ai'] }).canActivate(ctx(bearer(token)).context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('is 403 on a route without @ExternalAccess, 401 for a token it cannot verify or when it holds no signer', async () => {
    const token = signer.sign({ aud: 'hydromart-ai', sub: 'p1', role: 'MARKETING' }, 600, NOW);
    await expect(guard({}).canActivate(ctx(bearer(token)).context)).rejects.toBeInstanceOf(ForbiddenException);
    const other = new ExternalTokenSigner(buildTestConfig({ AI_TOKEN_SIGNING_KEY: keyB64() }));
    await expect(guard({ external: ['ai'] }, other).canActivate(ctx(bearer(token)).context)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard({ external: ['ai'] }, null).canActivate(ctx(bearer(token)).context)).rejects.toBeInstanceOf(UnauthorizedException);
    // Switched off: no keys at all, the kill switch.
    const off = new ExternalTokenSigner(buildTestConfig({ AI_TOKEN_SIGNING_KEY: '' }));
    expect(off.verificationKeys().size).toBe(0);
    await expect(guard({ external: ['ai'] }, off).canActivate(ctx(bearer(token)).context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('verifies a token signed by the previous key during a rotation', () => {
    expect(signer.verificationKeys().size).toBe(2);
    const same = keyB64();
    expect(new ExternalTokenSigner(buildTestConfig({ AI_TOKEN_SIGNING_KEY: same, AI_TOKEN_SIGNING_KEY_PREVIOUS: same })).verificationKeys().size).toBe(1);
  });
});

describe('AiTokenOnlyGuard', () => {
  it('lets the AI token in and refuses a staff session', () => {
    const guard = new AiTokenOnlyGuard();
    expect(guard.canActivate(ctx({}, { user: { via: 'ai' } }).context)).toBe(true);
    expect(() => guard.canActivate(ctx({}, { user: { role: 'SUPER_ADMIN' } }).context)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx({}).context)).toThrow(ForbiddenException);
  });
});

describe('AccountService.staffNamesByRoles', () => {
  const build = () => {
    const customers = new InMemoryCustomerRepository();
    const service = new AccountService(customers, { revokeAll: jest.fn() } as never, new AuditService(new InMemoryAuditLogRepository()));
    const seed = (role: string, fullName: string | null, over: Record<string, unknown> = {}) =>
      customers.seed(makeCustomer({ role: role as Role, fullName, phone: `+62811${customers.rows.size.toString().padStart(8, '0')}`, ...over }));
    return { service, seed };
  };

  it('names active staff only, skips unnamed and unknown roles, sorts by name, caps, and leaves phone and email out', async () => {
    const { service, seed } = build();
    seed(Role.MARKETING, 'Budi');
    seed(Role.MARKETING, '  Ani  ');
    seed(Role.MARKETING, 'Citra', { status: CustomerStatus.SUSPENDED });
    seed(Role.MARKETING, '   ');
    seed(Role.CUSTOMER, 'Pelanggan');
    seed('C_SALES', 'Dodi');
    const people = await service.staffNamesByRoles(['MARKETING', 'MARKETING', 'CUSTOMER', 'NOT_A_ROLE', 'C_SALES'], 10);
    expect(people.map((p) => p.fullName)).toEqual(['Ani', 'Budi', 'Dodi']);
    expect(Object.keys(people[0]!).sort()).toEqual(['fullName', 'id']);
    expect((await service.staffNamesByRoles(['MARKETING', 'C_SALES'], 2)).map((p) => p.fullName)).toEqual(['Ani', 'Budi']);
    await expect(service.staffNamesByRoles([], 5)).resolves.toEqual([]);
  });

  it('reads past the first page of a role', async () => {
    const { service, seed } = build();
    for (let i = 0; i < 130; i++) seed(Role.MARKETING, `Orang ${String(i).padStart(3, '0')}`);
    expect(await service.staffNamesByRoles(['MARKETING'], 500)).toHaveLength(130);
  });

  it('refuses to read an unbounded roster', async () => {
    const { service } = build();
    const endless = { listStaff: async () => ({ items: [makeCustomer({ role: Role.MARKETING, fullName: 'X' })], total: 1_000_000 }) };
    const big = new AccountService(endless as never, {} as never, new AuditService(new InMemoryAuditLogRepository()));
    await expect(big.staffNamesByRoles(['MARKETING'], 5)).rejects.toThrow();
    expect(service).toBeDefined();
  });
});

describe('AiCrmController', () => {
  it('reads the live matrix first, then asks for the roles that hold prospectCrm', async () => {
    const snapshot = jest.fn(async () => ({}));
    const staffNamesByRoles = jest.fn(async () => [{ id: 'i', fullName: 'N' }]);
    const controller = new AiCrmController({ staffNamesByRoles } as never, { snapshot } as never);
    await expect(controller.picCandidates()).resolves.toEqual({ people: [{ id: 'i', fullName: 'N' }] });
    expect(snapshot.mock.invocationCallOrder[0]).toBeLessThan(staffNamesByRoles.mock.invocationCallOrder[0]!);
    expect(staffNamesByRoles).toHaveBeenCalledWith(expect.arrayContaining(['SUPER_ADMIN', 'MARKETING']), 500);
  });
});
