import { ConsentNotWithdrawableError } from '../../src/domain/errors/auth.errors';
import {
  CONSENT_DOCUMENT_VERSION,
  ConsentService,
} from '../../src/application/services/consent.service';
import { ConsentController } from '../../src/modules/auth/consent.controller';
import {
  ConsentRecord,
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
