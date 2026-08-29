import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';

import { AUTH_TOKENS } from '../../src/application/tokens';
import { ConsentNotWithdrawableError } from '../../src/domain/errors/auth.errors';
import { ConsentLagQueryDto } from '../../src/modules/auth/dto/consent.dto';
import {
  CONSENT_DOCUMENT_VERSION,
  ConsentService,
  FLEET_LAG_DEFAULT_LIMIT,
  FLEET_LAG_MAX_LIMIT,
} from '../../src/application/services/consent.service';
import { ConsentController } from '../../src/modules/auth/consent.controller';
import { CAPABILITY_KEY, ROLES_KEY, Role } from '@hydromart/platform';
import {
  ConsentLagPage,
  ConsentLagReader,
} from '../../src/application/ports/consent.repository';
import { ConsentPrismaRepository } from '../../src/infrastructure/prisma/repositories/consent.prisma.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import {
  ConsentPurpose,
  ConsentRecord,
  MANDATORY_PURPOSES,
  currentConsents,
  hasConsent,
  isWithdrawable,
} from '../../src/domain/data-subject/consent';
import { InMemoryConsentRepository } from '../support/fakes';

const CUSTOMER = 'cust-1';

describe('consent domain', () => {
  it('only optional purposes are withdrawable', () => {
    expect(isWithdrawable('MARKETING')).toBe(true);
    expect(isWithdrawable('TERMS')).toBe(false);
    expect(isWithdrawable('PRIVACY')).toBe(false);
  });

  it('the newest row per purpose wins, and an unasked purpose is absent, not false', () => {
    const rows: ConsentRecord[] = [
      {
        id: '1',
        customerId: CUSTOMER,
        purpose: 'MARKETING',
        granted: true,
        documentVersion: '1.0',
        source: 'registration',
        recordedAt: new Date('2026-01-01'),
      },
      {
        id: '2',
        customerId: CUSTOMER,
        purpose: 'MARKETING',
        granted: false,
        documentVersion: '1.0',
        source: 'account-settings',
        recordedAt: new Date('2026-02-01'),
      },
    ];

    expect(currentConsents(rows).get('MARKETING')?.granted).toBe(false);
    expect(hasConsent(rows, 'MARKETING')).toBe(false);
    // Never asked: no row at all, so "granted" is false but the map holds nothing.
    expect(currentConsents(rows).has('TERMS')).toBe(false);
    expect(hasConsent(rows, 'TERMS')).toBe(false);
  });
});

describe('ConsentService', () => {
  let repo: InMemoryConsentRepository;
  let service: ConsentService;

  beforeEach(() => {
    repo = new InMemoryConsentRepository();
    service = new ConsentService(repo);
  });

  it('registration records the mandatory purposes and skips an unasked MARKETING', async () => {
    await service.recordRegistrationConsent(CUSTOMER);

    expect(repo.rows.map((r) => r.purpose).sort()).toEqual(['PRIVACY', 'TERMS']);
    const state = await service.stateFor(CUSTOMER);
    expect(state.find((s) => s.purpose === 'MARKETING')).toMatchObject({
      granted: false,
      decidedAt: null,
    });
  });

  it('refuses to withdraw a mandatory purpose and says deletion is the real request', async () => {
    await service.recordRegistrationConsent(CUSTOMER);

    await expect(service.set(CUSTOMER, 'PRIVACY', false)).rejects.toBeInstanceOf(
      ConsentNotWithdrawableError,
    );
    await expect(service.set(CUSTOMER, 'PRIVACY', false)).rejects.toThrow(/penghapusan akun/);
    // The refusal must not have appended anything.
    expect(repo.rows).toHaveLength(2);
  });

  it('grants and withdraws MARKETING, keeping every decision as history', async () => {
    await service.recordRegistrationConsent(CUSTOMER, true);

    await service.set(CUSTOMER, 'MARKETING', false);
    expect((await service.stateFor(CUSTOMER)).find((s) => s.purpose === 'MARKETING')).toMatchObject(
      {
        granted: false,
        withdrawable: true,
      },
    );

    await service.set(CUSTOMER, 'MARKETING', true);
    expect((await service.stateFor(CUSTOMER)).find((s) => s.purpose === 'MARKETING')?.granted).toBe(
      true,
    );
    // 3 registration rows + 2 later decisions — nothing was overwritten.
    expect(await service.history(CUSTOMER)).toHaveLength(5);
  });

  it('re-granting the same value is still recorded — "confirmed again today" is a fact', async () => {
    await service.set(CUSTOMER, 'MARKETING', true);
    await service.set(CUSTOMER, 'MARKETING', true);
    expect(repo.rows).toHaveLength(2);
  });

  it('one customer never sees another customer decisions', async () => {
    await service.recordRegistrationConsent(CUSTOMER);
    await service.recordRegistrationConsent('cust-2');
    expect(await service.history(CUSTOMER)).toHaveLength(2);
  });
});

describe('ConsentController', () => {
  const user = { sub: CUSTOMER } as never;

  it('maps state and history to ISO strings and forwards the switch', async () => {
    const repo = new InMemoryConsentRepository();
    const service = new ConsentService(repo);
    const controller = new ConsentController(service);
    await service.recordRegistrationConsent(CUSTOMER);

    const state = await controller.state(user);
    expect(state).toHaveLength(3);
    expect(state.find((s) => s.purpose === 'TERMS')).toMatchObject({
      mandatory: true,
      withdrawable: false,
    });
    expect(typeof state.find((s) => s.purpose === 'TERMS')?.decidedAt).toBe('string');

    const set = await controller.set(user, { purpose: 'MARKETING', granted: true } as never);
    expect(set).toMatchObject({ purpose: 'MARKETING', granted: true, source: 'account-settings' });

    expect(await controller.history(user)).toHaveLength(3);
  });
});

/*
 * W10. `CONSENT_DOCUMENT_VERSION` was '1.0' from the day the ledger shipped
 * (migration 20260729080000, which also backfilled every existing customer at '1.0')
 * until the Terms of Service were written for the first time a month later. So every
 * production row points at a version whose Terms document did not exist when it was
 * agreed to — and nothing in the repo ever COMPARED a stored version to the one in
 * force, so the ledger could prove when somebody agreed but not what to.
 */
describe('the document version in force', () => {
  let repo: InMemoryConsentRepository;
  let service: ConsentService;

  const retired = (purpose: ConsentRecord['purpose'], granted = true) => ({
    customerId: CUSTOMER,
    purpose,
    granted,
    documentVersion: '1.0',
    source: 'registration-backfill',
  });

  beforeEach(() => {
    repo = new InMemoryConsentRepository();
    service = new ConsentService(repo);
  });

  it('is no longer the placeholder that pointed at unwritten documents', () => {
    expect(CONSENT_DOCUMENT_VERSION).not.toBe('1.0');
  });

  it('reports the retired text as still to be accepted — without revoking it', async () => {
    await repo.recordMany([retired('TERMS'), retired('PRIVACY')]);

    expect(await service.pendingAcceptance(CUSTOMER)).toEqual(['TERMS', 'PRIVACY']);
    // The whole point: outdated is a prompt, not a revocation. Bumping the version must
    // not strip the lawful basis from an account that is mid-order.
    expect((await service.stateFor(CUSTOMER)).find((s) => s.purpose === 'TERMS')).toMatchObject({
      granted: true,
      outdated: true,
    });
  });

  it('has nothing to ask a customer who registered under the current text', async () => {
    await service.recordRegistrationConsent(CUSTOMER, true);

    expect(await service.pendingAcceptance(CUSTOMER)).toEqual([]);
    expect((await service.stateFor(CUSTOMER)).some((s) => s.outdated)).toBe(false);
  });

  it('asks an account that predates the ledger, which is not calling it a refusal', async () => {
    expect(await service.pendingAcceptance(CUSTOMER)).toEqual(['TERMS', 'PRIVACY']);

    const marketing = (await service.stateFor(CUSTOMER)).find((s) => s.purpose === 'MARKETING');
    // No row at all: nothing to be outdated about, and still not a "no".
    expect(marketing).toMatchObject({ decidedAt: null, granted: false, outdated: false });
  });

  it('never drags MARKETING into re-acceptance, so an opt-in survives a reword', async () => {
    await repo.recordMany([retired('TERMS'), retired('PRIVACY'), retired('MARKETING')]);

    expect(await service.pendingAcceptance(CUSTOMER)).not.toContain('MARKETING');
    expect((await service.stateFor(CUSTOMER)).find((s) => s.purpose === 'MARKETING')).toMatchObject(
      // Reported as outdated (it is a fact about that row) but never re-asked: a fresh
      // marketing prompt that the customer ignores would silently read as a withdrawal.
      { granted: true, outdated: true },
    );
  });

  it('re-accepting the current text clears the prompt', async () => {
    await repo.recordMany([retired('TERMS'), retired('PRIVACY')]);

    await service.set(CUSTOMER, 'TERMS', true, 're-consent');
    await service.set(CUSTOMER, 'PRIVACY', true, 're-consent');

    expect(await service.pendingAcceptance(CUSTOMER)).toEqual([]);
    // Append-only: the old acceptance is still on file as evidence of what was agreed then.
    expect(await service.history(CUSTOMER)).toHaveLength(4);
  });
});

/*
 * W10, second half. `pendingAcceptance` and the version comparison behind it already
 * worked — and nothing outside this service could reach them: no DTO named them, no route
 * returned them, so a client could not ask "am I behind?" and head office could not ask
 * "how many of us are?". `grep -rn pendingAcceptance src/modules/` was empty.
 *
 * These cover what opening that path has to keep apart: the re-acceptance question belongs
 * to the customer asking it, the fleet count belongs to head office, and neither may turn
 * "never asked" into "refused" on the way out.
 */
describe('ConsentService.fleetLag', () => {
  const page = (over: Partial<ConsentLagPage> = {}): ConsentLagPage => ({
    totals: { population: 4, current: 1, neverAsked: 1, refused: 1, outdated: 1 },
    items: [
      { id: 'cust-1', neverAsked: ['TERMS'], refused: [], outdated: [] },
      { id: 'cust-2', neverAsked: [], refused: ['PRIVACY'], outdated: ['TERMS'] },
    ],
    nextCursor: null,
    ...over,
  });
  const readerOf = (result = page()) => ({ mandatoryLag: jest.fn().mockResolvedValue(result) });
  const serviceWith = (reader: ConsentLagReader) =>
    new ConsentService(new InMemoryConsentRepository(), reader);

  it('asks only about the mandatory purposes, at the version in force', async () => {
    const reader = readerOf();
    const report = await serviceWith(reader).fleetLag({ limit: 10, cursor: 'cust-0' });

    expect(reader.mandatoryLag).toHaveBeenCalledWith({
      version: CONSENT_DOCUMENT_VERSION,
      purposes: MANDATORY_PURPOSES,
      limit: 10,
      cursor: 'cust-0',
    });
    // The version is echoed back: "how many are behind" means nothing without naming what
    // they are behind, least of all in a report that outlives the wording it counted.
    expect(report.documentVersion).toBe(CONSENT_DOCUMENT_VERSION);
    expect(report.totals.population).toBe(4);
  });

  it('caps the page, so the fleet report can never ask for the whole fleet', async () => {
    const reader = readerOf();
    await serviceWith(reader).fleetLag({ limit: 100000 });
    expect(reader.mandatoryLag).toHaveBeenCalledWith(
      expect.objectContaining({ limit: FLEET_LAG_MAX_LIMIT }),
    );

    await serviceWith(reader).fleetLag({});
    expect(reader.mandatoryLag).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: FLEET_LAG_DEFAULT_LIMIT, cursor: undefined }),
    );
  });

  it('keeps "never asked" and "refused" as two separate facts on the way out', async () => {
    const report = await serviceWith(readerOf()).fleetLag({});
    expect(report.items[0]).toEqual({
      id: 'cust-1',
      neverAsked: ['TERMS'],
      refused: [],
      outdated: [],
    });
    expect(report.items[1]?.refused).toEqual(['PRIVACY']);
  });

  it('refuses rather than reporting a zero it cannot stand behind', async () => {
    // Wired without its fleet reader, an unguarded implementation is free to answer
    // "nobody is behind" — the most dangerous possible lie from a compliance report.
    const service = new ConsentService(new InMemoryConsentRepository());
    await expect(service.fleetLag({})).rejects.toThrow(/fleet/i);
  });

  /*
   * The one thing hand-construction cannot check. `fleet` is a SECOND parameter on the same
   * DI token, and it is optional in TypeScript — so if Nest declined to fill it, every unit
   * test above would still pass and the live route would throw on its first call. This asks
   * the real container.
   */
  it('is handed its fleet reader by the container, not just by a test constructor', async () => {
    const provider = new ConsentPrismaRepository({
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { population: 1, current: 0, neverAsked: 1, refused: 0, outdated: 0 },
        ])
        .mockResolvedValueOnce([]),
    } as unknown as PrismaService);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConsentService,
        { provide: AUTH_TOKENS.ConsentRepository, useValue: provider },
      ],
    }).compile();

    const report = await moduleRef.get(ConsentService).fleetLag({});
    expect(report.totals.neverAsked).toBe(1);
  });
});

describe('ConsentController — the two questions W10 opened', () => {
  const user = { sub: CUSTOMER } as never;
  const retiredRows = (customerId = CUSTOMER) =>
    (['TERMS', 'PRIVACY', 'MARKETING'] as ConsentPurpose[]).map((purpose) => ({
      customerId,
      purpose,
      granted: true,
      documentVersion: '1.0',
      source: 'registration-backfill',
    }));

  it('tells the CALLER what they still have to accept, and that nothing is enforced', async () => {
    const repo = new InMemoryConsentRepository();
    await repo.recordMany(retiredRows());
    const controller = new ConsentController(new ConsentService(repo));

    expect(await controller.pending(user)).toEqual({
      documentVersion: CONSENT_DOCUMENT_VERSION,
      // MARKETING is outdated too, and still absent: re-asking an opt-in that the customer
      // then ignores would read as a withdrawal of one they already gave.
      purposes: ['TERMS', 'PRIVACY'],
      mustAccept: true,
      enforcement: 'UNENFORCED',
    });
  });

  it('says so plainly when there is nothing to re-accept', async () => {
    const service = new ConsentService(new InMemoryConsentRepository());
    await service.recordRegistrationConsent(CUSTOMER);

    expect(await new ConsentController(service).pending(user)).toMatchObject({
      purposes: [],
      mustAccept: false,
    });
  });

  it('surfaces `outdated` on the state route — the fact that was computed and dropped', async () => {
    const repo = new InMemoryConsentRepository();
    await repo.recordMany(retiredRows());
    const state = await new ConsentController(new ConsentService(repo)).state(user);
    expect(state.find((s) => s.purpose === 'TERMS')).toMatchObject({
      granted: true,
      outdated: true,
    });
  });

  it('hands head office a paginated fleet report', async () => {
    const mandatoryLag = jest.fn().mockResolvedValue({
      totals: { population: 2, current: 0, neverAsked: 1, refused: 0, outdated: 1 },
      items: [{ id: 'cust-9', neverAsked: [], refused: [], outdated: ['TERMS'] }],
      nextCursor: 'cust-9',
    } satisfies ConsentLagPage);
    const controller = new ConsentController(
      new ConsentService(new InMemoryConsentRepository(), { mandatoryLag }),
    );

    const report = await controller.report({ limit: 1, cursor: 'cust-8' });
    expect(mandatoryLag).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1, cursor: 'cust-8' }),
    );
    expect(report).toEqual({
      documentVersion: CONSENT_DOCUMENT_VERSION,
      totals: { population: 2, current: 0, neverAsked: 1, refused: 0, outdated: 1 },
      items: [{ customerId: 'cust-9', neverAsked: [], refused: [], outdated: ['TERMS'] }],
      nextCursor: 'cust-9',
    });
  });

  it('reads the page bounds off a query string, where every value arrives as text', () => {
    // `?limit=25` is the string '25'. Without the @Type coercion @IsInt rejects it and the
    // report 400s on its own documented example.
    const query = plainToInstance(ConsentLagQueryDto, { limit: '25', cursor: 'cust-1' });
    expect(query.limit).toBe(25);
    expect(query.cursor).toBe('cust-1');
  });

  it('defaults the page when the query carries neither bound', async () => {
    const mandatoryLag = jest.fn().mockResolvedValue({
      totals: { population: 0, current: 0, neverAsked: 0, refused: 0, outdated: 0 },
      items: [],
      nextCursor: null,
    } satisfies ConsentLagPage);
    const controller = new ConsentController(
      new ConsentService(new InMemoryConsentRepository(), { mandatoryLag }),
    );

    await controller.report({});
    expect(mandatoryLag).toHaveBeenCalledWith(
      expect.objectContaining({ limit: FLEET_LAG_DEFAULT_LIMIT }),
    );
  });
});

/*
 * The fleet query is two SQL statements sharing their CTEs, so what a unit test can hold is
 * the contract around them: that the page is bounded and cursored, and that a customer the
 * ledger has no row for comes back as NEVER_ASKED rather than as a refusal. The SQL itself
 * needs a Postgres, and this suite has none.
 */
describe('ConsentPrismaRepository.mandatoryLag', () => {
  const query = {
    version: '2026-08-29',
    purposes: ['TERMS', 'PRIVACY'] as ConsentPurpose[],
    limit: 2,
  };
  const totalsRow = { population: 3, current: 1, neverAsked: 1, refused: 1, outdated: 1 };
  const repoWith = (rows: unknown[]) => {
    const $queryRaw = jest.fn().mockResolvedValueOnce([totalsRow]).mockResolvedValueOnce(rows);
    return {
      repo: new ConsentPrismaRepository({ $queryRaw } as unknown as PrismaService),
      $queryRaw,
    };
  };

  it('derives "never asked" from the purposes the ledger holds no row for', async () => {
    const { repo, $queryRaw } = repoWith([
      { id: 'cust-1', present: ['TERMS'], refused: [], outdated: ['TERMS'] },
      { id: 'cust-2', present: [], refused: [], outdated: [] },
    ]);

    const page = await repo.mandatoryLag(query);
    expect(page.items).toEqual([
      // Asked about TERMS under retired wording, never asked about PRIVACY at all — two
      // different facts about one account, and neither of them is a "no".
      { id: 'cust-1', neverAsked: ['PRIVACY'], refused: [], outdated: ['TERMS'] },
      { id: 'cust-2', neverAsked: ['TERMS', 'PRIVACY'], refused: [], outdated: [] },
    ]);
    expect(page.totals).toEqual(totalsRow);
    // Two statements: the fleet totals, and one bounded page. Not one per customer.
    expect($queryRaw).toHaveBeenCalledTimes(2);
  });

  it('reports an explicit refusal as a refusal, never folded into the gap', async () => {
    const { repo } = repoWith([{ id: 'cust-3', present: ['TERMS'], refused: ['TERMS'], outdated: [] }]);
    expect((await repo.mandatoryLag(query)).items[0]).toEqual({
      id: 'cust-3',
      neverAsked: ['PRIVACY'],
      refused: ['TERMS'],
      outdated: [],
    });
  });

  it('hands back a cursor only while the page is full', async () => {
    const full = await repoWith([
      { id: 'a', present: [], refused: [], outdated: [] },
      { id: 'b', present: [], refused: [], outdated: [] },
    ]).repo.mandatoryLag(query);
    expect(full.nextCursor).toBe('b');

    const short = await repoWith([
      { id: 'a', present: [], refused: [], outdated: [] },
    ]).repo.mandatoryLag(query);
    expect(short.nextCursor).toBeNull();
  });

  it('accepts a cursor without changing the shape of the answer', async () => {
    const { repo } = repoWith([]);
    const page = await repo.mandatoryLag({ ...query, cursor: 'cust-1' });
    expect(page).toEqual({ totals: totalsRow, items: [], nextCursor: null });
  });
});

/*
 * WHICH capability guards each route, pinned by name.
 *
 * Measured 2026-08-30, and this is why the block exists: swapping `@Can('pdpRequests')` for
 * `@Can('hqConsole')` on GET /account/consents/report — which widens who may pull a list of
 * identified customer ids from the PDP desk to every DIREKTUR — left the whole auth-service
 * suite at 29/29 green AND `node scripts/check-route-authz.mjs` at exit 0. That checker asks
 * whether a route is guarded at all, not which capability it is guarded WITH, so the one new
 * route that emits an enumerable list of customer ids was the one part of this change with no
 * gate that could go red.
 *
 * Read straight off the handler's metadata rather than through a request, so it fails on the
 * decorator itself and cannot be satisfied by a guard that happens to allow the same roles
 * today. Capability-to-role is a runtime map a SUPER_ADMIN can retune; the binding here is
 * the thing that must not drift.
 */
describe('consent routes are bound to the capability they were reasoned about', () => {
  const capabilityOf = (method: keyof ConsentController) =>
    Reflect.getMetadata(CAPABILITY_KEY, ConsentController.prototype[method] as object) as
      | string
      | undefined;
  const rolesOf = (method: keyof ConsentController) =>
    Reflect.getMetadata(ROLES_KEY, ConsentController.prototype[method] as object) as
      | string[]
      | undefined;

  it('the fleet report is PDP desk work, not general HQ console work', () => {
    // `pdpRequests` is the capability that already decides an export or a deletion. A
    // director holds `hqConsole`; this answer names identified accounts, so it belongs with
    // the rest of the data-protection desk and nowhere wider.
    expect(capabilityOf('report')).toBe('pdpRequests');
  });

  it('the personal question is the caller asking about themselves', () => {
    // No capability and no path parameter: `pending` reads `user.sub`. A CUSTOMER role is the
    // whole authorisation, because there is no id to widen it with.
    expect(capabilityOf('pending')).toBeUndefined();
    expect(rolesOf('pending')).toEqual([Role.CUSTOMER]);
  });

  it('and the fleet report is not reachable as a customer', () => {
    // The counterpart of the assertion above: if `report` ever gained @Roles(CUSTOMER) it
    // would hand the enumerable list to the people it is a list OF.
    expect(rolesOf('report') ?? []).not.toContain(Role.CUSTOMER);
  });
});
