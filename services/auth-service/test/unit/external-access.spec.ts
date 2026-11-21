import { createHash, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';

import { verifyExternalToken } from '@hydromart/platform';

import { AuditService } from '../../src/application/services/audit.service';
import {
  EXTERNAL_TOKEN_TTL_SECONDS,
  ExternalAccessService,
} from '../../src/application/services/external-access.service';
import {
  machineSecretLive,
  parseMachineAccounts,
  parseSigningKey,
  publicJwk,
} from '../../src/config/external-access';
import { envValidationSchema } from '../../src/config/env.validation';
import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
import { Role } from '../../src/domain/customer/role.enum';
import { ExternalTokenSigner } from '../../src/infrastructure/security/external-token-signer';
import { ExternalAccessController } from '../../src/modules/auth/external-access.controller';
import {
  FakeClock,
  InMemoryAuditLogRepository,
  InMemoryCustomerRepository,
  buildTestConfig,
  makeCustomer,
} from '../support/fakes';

const NOW = new Date();
const DAY = 86_400_000;
const ACCOUNT_ID = '7d2c3f64-1e0b-4a59-9b7e-2f1f8c7a6d10';
const SECRET = 'n8n-secret-that-is-long-enough-to-pass-0001';
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const challengeOf = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
const VERIFIER = 'v'.repeat(43);
const ctx = { ipAddress: '10.0.0.1', userAgent: 'jest' };

const keyB64 = (curve = 'prime256v1') =>
  generateKeyPairSync('ec', { namedCurve: curve })
    .privateKey.export({ format: 'der', type: 'pkcs8' })
    .toString('base64');

const machine = (over: Record<string, unknown> = {}) => ({
  id: ACCOUNT_ID,
  name: 'n8n',
  secretSha256: sha(SECRET),
  scopes: ['hqConsole'],
  notAfter: new Date(NOW.getTime() + 30 * DAY).toISOString(),
  ...over,
});

/** The keys a service would hold after reading this signer's JWKS. */
function verifierKeys(signer: ExternalTokenSigner): Map<string, KeyObject> {
  return new Map(
    signer.jwks().keys.map((k) => [
      k.kid,
      createPublicKey({ key: { kty: k.kty, crv: k.crv, x: k.x, y: k.y }, format: 'jwk' }),
    ]),
  );
}

function setup(env: Record<string, string> = {}) {
  const config = buildTestConfig({
    AI_TOKEN_SIGNING_KEY: keyB64(),
    MACHINE_ACCOUNTS: JSON.stringify([machine()]),
    ...env,
  });
  const signer = new ExternalTokenSigner(config);
  const customers = new InMemoryCustomerRepository();
  const auditLog = new InMemoryAuditLogRepository();
  const clock = new FakeClock(NOW);
  const service = new ExternalAccessService(
    customers,
    clock,
    signer,
    new AuditService(auditLog),
    config,
  );
  const staff = makeCustomer({ role: Role.HEAD_OFFICE, assignedDepotId: 'depot-1' });
  customers.seed(staff);
  const caller = { sub: staff.id, role: staff.role };
  return { signer, customers, auditLog, clock, service, staff, caller };
}

describe('external-access config', () => {
  it('accepts a P-256 key and refuses another curve', () => {
    expect(parseSigningKey(keyB64()).asymmetricKeyType).toBe('ec');
    expect(() => parseSigningKey(keyB64('secp384r1'))).toThrow('not an EC P-256');
  });

  it('names the key by its RFC 7638 thumbprint', () => {
    const jwk = publicJwk(parseSigningKey(keyB64()));
    const expected = createHash('sha256')
      .update(`{"crv":"P-256","kty":"EC","x":"${jwk.x}","y":"${jwk.y}"}`)
      .digest('base64url');
    expect(jwk).toMatchObject({ kid: expected, alg: 'ES256', use: 'sig' });
  });

  it('parses machine accounts and refuses each malformed field', () => {
    expect(parseMachineAccounts('', NOW)).toEqual([]);
    expect(parseMachineAccounts(JSON.stringify([machine()]), NOW)[0]?.scopes).toEqual(['hqConsole']);
    const bad: Array<[unknown, string]> = [
      [{}, 'JSON list'],
      [[null], '.id must be a UUID'],
      [[machine({ name: 'N8N' })], '.name'],
      [[machine({ secretSha256: 'abc' })], '.secretSha256'],
      [[machine({ scopes: [] })], 'at least one capability'],
      [[machine({ scopes: ['rootShell'] })], '"rootShell" is not a capability'],
      [[machine({ scopes: [7] })], '"7" is not a capability'],
      [[machine({ notAfter: 'soon' })], 'ISO date'],
      [[machine({ notAfter: 5 })], 'ISO date'],
      [[machine({ notAfter: new Date(NOW.getTime() + 91 * DAY).toISOString() })], '90 days'],
    ];
    for (const [value, message] of bad) {
      expect(() => parseMachineAccounts(JSON.stringify(value), NOW)).toThrow(message);
    }
  });

  it('a secret works until its day and never further than 90 days out', () => {
    const [account] = parseMachineAccounts(JSON.stringify([machine()]), NOW);
    expect(machineSecretLive(account!, NOW)).toBe(true);
    expect(machineSecretLive(account!, new Date(NOW.getTime() + 31 * DAY))).toBe(false);
    expect(machineSecretLive(account!, new Date(NOW.getTime() - 61 * DAY))).toBe(false);
  });

  it('boot refuses a key or an account list that does not parse, and allows both blank', () => {
    const base = {
      AUTH_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
      JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-01',
      JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-1',
      OTP_PEPPER: 'test-otp-pepper-value',
      INTERNAL_SERVICE_KEY: 'test-internal-service-key-0123456',
    };
    expect(envValidationSchema.validate(base).error).toBeUndefined();
    expect(
      envValidationSchema.validate({
        ...base,
        AI_TOKEN_SIGNING_KEY: keyB64(),
        MACHINE_ACCOUNTS: JSON.stringify([machine()]),
      }).error,
    ).toBeUndefined();
    expect(
      envValidationSchema.validate({ ...base, AI_TOKEN_SIGNING_KEY: 'bm90LWEta2V5' }).error,
    ).toBeDefined();
    expect(
      envValidationSchema.validate({ ...base, AI_TOKEN_SIGNING_KEY_PREVIOUS: keyB64('secp384r1') })
        .error,
    ).toBeDefined();
    expect(envValidationSchema.validate({ ...base, MACHINE_ACCOUNTS: '[{}]' }).error).toBeDefined();
  });
});

describe('ExternalTokenSigner', () => {
  it('publishes nothing and signs nothing when switched off, the previous key included', () => {
    const signer = new ExternalTokenSigner(
      buildTestConfig({ AI_TOKEN_SIGNING_KEY: '', AI_TOKEN_SIGNING_KEY_PREVIOUS: keyB64() }),
    );
    expect(signer.enabled).toBe(false);
    expect(signer.jwks()).toEqual({ keys: [] });
    expect(() => signer.sign({ aud: 'x', sub: 'y' }, 60, NOW)).toThrow('switched off');
  });

  it('publishes the previous key beside the current one, once', () => {
    const current = keyB64();
    expect(
      new ExternalTokenSigner(
        buildTestConfig({ AI_TOKEN_SIGNING_KEY: current, AI_TOKEN_SIGNING_KEY_PREVIOUS: keyB64() }),
      ).jwks().keys,
    ).toHaveLength(2);
    expect(
      new ExternalTokenSigner(
        buildTestConfig({ AI_TOKEN_SIGNING_KEY: current, AI_TOKEN_SIGNING_KEY_PREVIOUS: current }),
      ).jwks().keys,
    ).toHaveLength(1);
  });

  it('signs what the HD-2 verifier accepts, and only under the published key', () => {
    const { signer } = setup();
    const token = signer.sign({ aud: 'hydromart-ai', sub: 's1', role: 'FINANCE' }, 900, NOW);
    expect(verifyExternalToken(token, verifierKeys(signer), NOW.getTime())).toMatchObject({
      sub: 's1',
      via: 'ai',
      role: 'FINANCE',
    });
    expect(verifyExternalToken(token, verifierKeys(setup().signer), NOW.getTime())).toBeNull();
    expect(verifyExternalToken(token, verifierKeys(signer), NOW.getTime() + 901_000)).toBeNull();
  });
});

describe('ExternalAccessService handoff', () => {
  it('trades a code and the right verifier for an AI token with the person own role', async () => {
    const { service, signer, staff, caller, auditLog } = setup();
    const { code, expiresIn } = await service.issueHandoffCode(caller, challengeOf(VERIFIER), ctx);
    expect(expiresIn).toBe(60);

    const result = await service.exchangeHandoffCode(code, VERIFIER, ctx);
    expect(result).toMatchObject({ tokenType: 'Bearer', expiresIn: EXTERNAL_TOKEN_TTL_SECONDS });
    expect(verifyExternalToken(result.accessToken, verifierKeys(signer), NOW.getTime())).toEqual({
      sub: staff.id,
      via: 'ai',
      role: Role.HEAD_OFFICE,
      depotId: 'depot-1',
      scopes: [],
    });
    expect(auditLog.entries.map((e) => e.action)).toEqual([
      'auth.handoff.code_issued',
      'auth.handoff.exchanged',
    ]);
  });

  it('spends the code on first use, so a replay fails', async () => {
    const { service, caller } = setup();
    const { code } = await service.issueHandoffCode(caller, challengeOf(VERIFIER), ctx);
    await service.exchangeHandoffCode(code, VERIFIER, ctx);
    await expect(service.exchangeHandoffCode(code, VERIFIER, ctx)).rejects.toMatchObject({
      code: 'AUTH_HANDOFF_INVALID',
    });
  });

  it('a wrong verifier fails and spends the code too', async () => {
    const { service, caller, auditLog } = setup();
    const { code } = await service.issueHandoffCode(caller, challengeOf(VERIFIER), ctx);
    await expect(service.exchangeHandoffCode(code, 'w'.repeat(43), ctx)).rejects.toMatchObject({
      code: 'AUTH_HANDOFF_INVALID',
    });
    await expect(service.exchangeHandoffCode(code, VERIFIER, ctx)).rejects.toMatchObject({
      code: 'AUTH_HANDOFF_INVALID',
    });
    expect(auditLog.entries.slice(1).map((e) => e.metadata?.reason)).toEqual(['verifier', 'unknown']);
  });

  it('a code older than 60 seconds is refused', async () => {
    const { service, caller, clock, auditLog } = setup();
    const { code } = await service.issueHandoffCode(caller, challengeOf(VERIFIER), ctx);
    clock.advance(60);
    await expect(service.exchangeHandoffCode(code, VERIFIER, ctx)).rejects.toMatchObject({
      code: 'AUTH_HANDOFF_INVALID',
    });
    expect(auditLog.entries[1]?.metadata?.reason).toBe('expired');
  });

  it('reads the account again at exchange: gone, suspended or now a customer', async () => {
    const { service, customers, staff, caller, auditLog } = setup();
    const issue = () => service.issueHandoffCode(caller, challengeOf(VERIFIER), ctx);

    let { code } = await issue();
    customers.rows.set(staff.id, { ...staff.toProps(), status: CustomerStatus.SUSPENDED });
    await expect(service.exchangeHandoffCode(code, VERIFIER, ctx)).rejects.toThrow('suspended');

    ({ code } = await issue());
    customers.rows.set(staff.id, { ...staff.toProps(), role: Role.CUSTOMER });
    await expect(service.exchangeHandoffCode(code, VERIFIER, ctx)).rejects.toMatchObject({
      code: 'AUTH_HANDOFF_STAFF_ONLY',
    });

    ({ code } = await issue());
    customers.rows.delete(staff.id);
    await expect(service.exchangeHandoffCode(code, VERIFIER, ctx)).rejects.toMatchObject({
      code: 'AUTH_HANDOFF_INVALID',
    });
    expect(
      auditLog.entries.filter((e) => e.action === 'auth.handoff.failed').map((e) => e.metadata?.reason),
    ).toEqual(['account', 'account', 'account']);
  });

  it('one person holds at most three live codes; a fourth retires their oldest', async () => {
    const { service, caller } = setup();
    const codes: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      codes.push((await service.issueHandoffCode(caller, challengeOf(VERIFIER), ctx)).code);
    }
    await expect(service.exchangeHandoffCode(codes[0]!, VERIFIER, ctx)).rejects.toMatchObject({
      code: 'AUTH_HANDOFF_INVALID',
    });
    await expect(service.exchangeHandoffCode(codes[3]!, VERIFIER, ctx)).resolves.toBeDefined();
  });

  it('refuses customers, a full queue, and everything when switched off', async () => {
    const { service, caller, clock } = setup();
    await expect(
      service.issueHandoffCode({ sub: 'c1', role: Role.CUSTOMER }, challengeOf(VERIFIER), ctx),
    ).rejects.toMatchObject({ code: 'AUTH_HANDOFF_STAFF_ONLY' });

    for (let i = 0; i < 1000; i += 1) {
      await service.issueHandoffCode({ ...caller, sub: `staff-${i}` }, challengeOf(VERIFIER), ctx);
    }
    await expect(service.issueHandoffCode(caller, challengeOf(VERIFIER), ctx)).rejects.toMatchObject({
      code: 'AUTH_HANDOFF_BUSY',
    });
    clock.advance(61); // expired codes are swept, which makes room again
    await expect(service.issueHandoffCode(caller, challengeOf(VERIFIER), ctx)).resolves.toBeDefined();

    const off = setup({ AI_TOKEN_SIGNING_KEY: '' });
    await expect(off.service.issueHandoffCode(off.caller, challengeOf(VERIFIER), ctx)).rejects.toMatchObject({
      code: 'AUTH_EXTERNAL_TOKENS_OFF',
    });
    await expect(off.service.exchangeHandoffCode('x', VERIFIER, ctx)).rejects.toMatchObject({
      code: 'AUTH_EXTERNAL_TOKENS_OFF',
    });
    await expect(off.service.issueMachineToken(ACCOUNT_ID, SECRET, ctx)).rejects.toMatchObject({
      code: 'AUTH_EXTERNAL_TOKENS_OFF',
    });
  });
});

describe('ExternalAccessService machine accounts', () => {
  it('trades id + secret for a machine token carrying exactly its scopes', async () => {
    const { service, signer, auditLog } = setup();
    const result = await service.issueMachineToken(ACCOUNT_ID, SECRET, ctx);
    expect(verifyExternalToken(result.accessToken, verifierKeys(signer), NOW.getTime())).toEqual({
      sub: ACCOUNT_ID,
      via: 'machine',
      role: null,
      depotId: null,
      scopes: ['hqConsole'],
    });
    expect(auditLog.entries[0]).toMatchObject({
      customerId: ACCOUNT_ID,
      action: 'auth.machine.token_issued',
      metadata: { name: 'n8n' },
    });
  });

  it('refuses a wrong secret, an unknown id and a secret past its day, saying which', async () => {
    const { service, clock, auditLog } = setup();
    await expect(service.issueMachineToken(ACCOUNT_ID, `${SECRET}x`, ctx)).rejects.toMatchObject({
      code: 'AUTH_MACHINE_INVALID',
    });
    await expect(
      service.issueMachineToken('00000000-0000-4000-8000-000000000000', SECRET, ctx),
    ).rejects.toMatchObject({ code: 'AUTH_MACHINE_INVALID' });
    clock.advance(31 * 86_400);
    await expect(service.issueMachineToken(ACCOUNT_ID, SECRET, ctx)).rejects.toMatchObject({
      code: 'AUTH_MACHINE_INVALID',
    });
    expect(auditLog.entries.map((e) => e.metadata?.reason)).toEqual([
      'credentials',
      'credentials',
      'expired',
    ]);
  });
});

describe('ExternalAccessController', () => {
  it('passes each call through with the request context', async () => {
    const { service, signer, caller } = setup();
    const controller = new ExternalAccessController(service, signer);
    const req = { ip: '10.0.0.9', headers: { 'user-agent': 'n8n' } } as never;

    expect(controller.jwks().keys).toHaveLength(1);
    const { code } = await controller.handoffCode(
      caller as never,
      { codeChallenge: challengeOf(VERIFIER), codeChallengeMethod: 'S256' },
      req,
    );
    await expect(controller.handoffToken({ code, codeVerifier: VERIFIER }, req)).resolves.toMatchObject({
      tokenType: 'Bearer',
    });
    await expect(
      controller.machineToken({ accountId: ACCOUNT_ID, secret: SECRET }, req),
    ).resolves.toMatchObject({ tokenType: 'Bearer' });
  });
});
