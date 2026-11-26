import { ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ApproverDirectoryPort } from '../../src/application/ports/approver-directory.port';
import { StaffEmail } from '../../src/application/ports/staff-email.port';
import { AiAccessRequestService } from '../../src/application/services/ai-access-request.service';
import { NotificationService } from '../../src/application/services/notification.service';
import { PushService } from '../../src/application/services/push.service';
import { accessRequestText } from '../../src/domain/ai-access-request';
import { destinationFor } from '../../src/domain/notification-destination';
import {
  NotificationEvent,
  PERSONAL_OPS_EVENTS,
  STAFF_TOGGLE_FOR_EVENT,
  renderMessage,
  templateFor,
} from '../../src/domain/notification-event';
import { STAFF_EMAIL_TEMPLATES } from '../../src/domain/staff-email';
import { ApproverDirectoryHttpAdapter } from '../../src/infrastructure/http/approver-directory.http.adapter';
import { LegalEntityNamesHttpAdapter } from '../../src/infrastructure/http/legal-entity-names.http.adapter';
import { AiAccessRequestedDto } from '../../src/modules/dto/notification.dto';
import { NotificationExternalController } from '../../src/modules/notification-external.controller';
import { InMemoryNotificationRepository } from '../support/fakes';

/*
 * AI-7c: someone in the AI web asks for access. n8n carries ids; hydromart looks up the names,
 * writes the words and tells the people who hold legalEntityAiAccess, one notification each.
 */
const EVENT = 'ai-access-request:00000000-0000-4000-8000-000000000001';
const REQUESTER = '11111111-1111-4111-8111-111111111111';
const ENTITY = '22222222-2222-4222-8222-222222222222';
const ZERO_WIDTH = String.fromCharCode(0x200b);
const BIDI = String.fromCharCode(0x202e);
const NL = String.fromCharCode(10);
const TAB = String.fromCharCode(9);

describe('accessRequestText', () => {
  it('names the person, their role and the entities, which win over the data group', () => {
    expect(
      accessRequestText(
        { fullName: 'Budi Santoso', role: 'HEAD_OFFICE' },
        ['Indowater', 'Mitra A'],
        'money',
      ),
    ).toEqual({
      who: 'Budi Santoso (HEAD OFFICE)',
      what: 'Indowater, Mitra A',
    });
  });

  it('says "Seorang staf" when no name is on file, and the data group when no entity is named', () => {
    expect(accessRequestText({ fullName: null, role: 'MANAGER' }, [], 'hr')).toEqual({
      who: 'Seorang staf (MANAGER)',
      what: 'data SDM',
    });
    expect(
      accessRequestText({ fullName: ` ${ZERO_WIDTH} `, role: 'MANAGER' }, [], undefined),
    ).toEqual({
      who: 'Seorang staf (MANAGER)',
      what: 'data yang belum diizinkan',
    });
    expect(accessRequestText({ fullName: 'X', role: 'MANAGER' }, [], 'nope').what).toBe(
      'data yang belum diizinkan',
    );
  });

  it('keeps a name on one line', () => {
    expect(
      accessRequestText({ fullName: `Budi${NL}Santoso${TAB}${BIDI}`, role: 'MANAGER' }, [], 'stock')
        .who,
    ).toBe('Budi Santoso (MANAGER)');
  });
});

describe('the AI_ACCESS_REQUESTED event', () => {
  it('reads the same in both languages', () => {
    const vars = { who: 'Budi (MANAGER)', what: 'Indowater' };
    expect(renderMessage(templateFor(NotificationEvent.AI_ACCESS_REQUESTED, 'id'), vars)).toBe(
      'Budi (MANAGER) meminta akses AI web untuk Indowater. Buka Badan hukum, bagian akses AI, untuk memberikannya.',
    );
    expect(renderMessage(templateFor(NotificationEvent.AI_ACCESS_REQUESTED, 'en'), vars)).toContain(
      'asks for AI web access to Indowater',
    );
  });

  it('is for its recipient only, on its own switch, with an email and a tap to the access matrix', () => {
    expect(PERSONAL_OPS_EVENTS).toContain(NotificationEvent.AI_ACCESS_REQUESTED);
    expect(STAFF_TOGGLE_FOR_EVENT[NotificationEvent.AI_ACCESS_REQUESTED]).toBe('aiAccessRequest');
    expect(STAFF_EMAIL_TEMPLATES[NotificationEvent.AI_ACCESS_REQUESTED]).toEqual({
      subject: expect.stringContaining('{{what}}'),
      body: expect.stringContaining('{{who}}'),
    });
    expect(destinationFor(NotificationEvent.AI_ACCESS_REQUESTED, {})).toBe('/hq/legal-entities');
  });
});

describe('AiAccessRequestedDto', () => {
  const check = async (body: object) =>
    validate(plainToInstance(AiAccessRequestedDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  const uuids = (n: number) =>
    Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

  it('takes ids only: eventId, requester, optional entities and group', async () => {
    expect(await check({ eventId: EVENT, requesterAccountId: REQUESTER })).toEqual([]);
    expect(
      await check({
        eventId: EVENT,
        requesterAccountId: REQUESTER,
        legalEntityIds: [ENTITY],
        group: 'gallons',
      }),
    ).toEqual([]);
    expect(
      await check({ eventId: EVENT, requesterAccountId: REQUESTER, legalEntityIds: uuids(20) }),
    ).toEqual([]);
  });

  it.each([
    [
      'an eventId without the prefix',
      { eventId: '3f1e2d4c-8b7a-4f60-9e21-5c4b3a291807', requesterAccountId: REQUESTER },
    ],
    [
      'a requester that is a uuid but not a v4',
      { eventId: EVENT, requesterAccountId: '11111111-1111-1111-8111-111111111111' },
    ],
    ['a requester that is not a uuid', { eventId: EVENT, requesterAccountId: 'budi' }],
    [
      'an entity that is not a uuid',
      { eventId: EVENT, requesterAccountId: REQUESTER, legalEntityIds: ['x'] },
    ],
    [
      'twenty-one entities',
      { eventId: EVENT, requesterAccountId: REQUESTER, legalEntityIds: uuids(21) },
    ],
    [
      'the same entity twice',
      { eventId: EVENT, requesterAccountId: REQUESTER, legalEntityIds: [ENTITY, ENTITY] },
    ],
    [
      'the same entity twice in two spellings',
      {
        eventId: EVENT,
        requesterAccountId: REQUESTER,
        legalEntityIds: [ENTITY, ENTITY.toUpperCase()],
      },
    ],
    ['an unknown group', { eventId: EVENT, requesterAccountId: REQUESTER, group: 'secrets' }],
    [
      'a field it does not know (a name, say)',
      { eventId: EVENT, requesterAccountId: REQUESTER, name: 'Budi' },
    ],
  ])('refuses %s', async (_label, body) => {
    expect((await check(body)).length).toBeGreaterThan(0);
  });
});

const STAFF: Record<string, { fullName: string | null; role: string }> = {};

function build(
  roles: Record<string, string> = {
    'sa-1': 'SUPER_ADMIN',
    'sa-2': 'SUPER_ADMIN',
    'ho-1': 'HEAD_OFFICE',
  },
) {
  STAFF[REQUESTER] = { fullName: 'Budi Santoso', role: 'HEAD_OFFICE' };
  delete STAFF[ENTITY];
  const pushed: string[] = [];
  const emailed: StaffEmail[] = [];
  const repo = new InMemoryNotificationRepository();
  const notifications = new NotificationService(
    repo,
    {
      sendToCustomer: async (id: string) => (pushed.push(id), { devices: 1, delivered: 1 }),
    } as unknown as PushService,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { send: async (e: StaffEmail) => void emailed.push(e) },
  );
  const directory: ApproverDirectoryPort = {
    staffIdsByRoles: jest.fn(async (wanted: readonly string[]) =>
      Object.keys(roles).filter((id) => wanted.includes(roles[id]!)),
    ),
    rolesOf: async (ids) => new Map(ids.filter((i) => roles[i]).map((i) => [i, roles[i]!])),
    profileOf: jest.fn(async (id: string) => STAFF[id] ?? null),
  };
  const namesOf = jest.fn(async (ids: readonly string[]) =>
    ids.map((id) => (id === ENTITY ? 'Indowater' : '')).filter(Boolean),
  );
  const service = new AiAccessRequestService(notifications, directory, { namesOf });
  return { service, repo, pushed, emailed, directory, namesOf };
}
const drain = () => new Promise((r) => setImmediate(r));

describe('AiAccessRequestService', () => {
  it('files one row per holder of legalEntityAiAccess, with the text hydromart wrote, and pushes and emails them', async () => {
    const { service, repo, pushed, emailed, directory } = build();
    await expect(service.run(EVENT, REQUESTER, [ENTITY])).resolves.toEqual({
      recipients: 2,
      notified: 2,
      whatsapp: 'pending',
    });
    await drain();
    // The roles asked for are the ones that hold the capability, not a list kept here.
    expect(directory.staffIdsByRoles).toHaveBeenCalledWith(['SUPER_ADMIN']);
    expect(repo.records.map((r) => r.customerId).sort()).toEqual(['sa-1', 'sa-2']);
    expect(repo.records[0]).toMatchObject({
      event: 'AI_ACCESS_REQUESTED',
      phone: '',
      depotId: null,
      destination: '/hq/legal-entities',
      message:
        'Budi Santoso (HEAD OFFICE) meminta akses AI web untuk Indowater. Buka Badan hukum, bagian akses AI, untuk memberikannya.',
    });
    expect(pushed.sort()).toEqual(['sa-1', 'sa-2']);
    expect(emailed.map((e) => e.accountIds)).toEqual([['sa-1'], ['sa-2']]);
    expect(emailed[0]).toMatchObject({ toggle: 'aiAccessRequest', path: '/hq/legal-entities' });
    expect(emailed[0]!.subject).toContain('Indowater');
  });

  it('says the data group when no entity is named, and "Seorang staf" when no name is on file', async () => {
    const { service, repo, namesOf } = build();
    STAFF[REQUESTER] = { fullName: null, role: 'MANAGER' };
    await service.run(EVENT, REQUESTER, [], 'money');
    expect(namesOf).not.toHaveBeenCalled();
    expect(repo.records[0]!.message).toContain(
      'Seorang staf (MANAGER) meminta akses AI web untuk data keuangan.',
    );
  });

  it('files nothing twice for a retry or a replay, and a new event is a new request', async () => {
    const { service, repo, pushed, emailed } = build();
    await service.run(EVENT, REQUESTER, [ENTITY]);
    await service.run(EVENT, REQUESTER, [ENTITY]);
    await drain();
    expect([repo.records.length, pushed.length, emailed.length]).toEqual([2, 2, 2]);
    await service.run(EVENT.replace(/1$/, '2'), REQUESTER, [ENTITY]);
    expect(repo.records).toHaveLength(4);
  });

  it('answers notified 0, with no error, for a requester who does not exist or can already grant access', async () => {
    const { service, repo, namesOf } = build();
    await expect(service.run(EVENT, ENTITY)).resolves.toEqual({
      recipients: 0,
      notified: 0,
      whatsapp: 'pending',
    });
    STAFF[ENTITY] = { fullName: 'Super', role: 'SUPER_ADMIN' };
    await expect(service.run(EVENT, ENTITY, [ENTITY])).resolves.toMatchObject({ notified: 0 });
    expect(repo.records).toHaveLength(0);
    expect(namesOf).not.toHaveBeenCalled();
  });

  it('tells nobody, and says so, when no account holds the capability', async () => {
    const { service, repo } = build({ 'ho-1': 'HEAD_OFFICE' });
    await expect(service.run(EVENT, REQUESTER)).resolves.toEqual({
      recipients: 0,
      notified: 0,
      whatsapp: 'pending',
    });
    expect(repo.records).toHaveLength(0);
  });

  it('skips an account whose role the directory cannot tell', async () => {
    const { service, directory } = build();
    directory.rolesOf = async () => new Map();
    await expect(service.run(EVENT, REQUESTER)).resolves.toMatchObject({ recipients: 0 });
  });

  it('refuses with 503, filing nothing, when the requester, the entity names or the recipients cannot be read', async () => {
    const a = build();
    (a.directory.profileOf as jest.Mock).mockRejectedValue(new Error('auth down'));
    await expect(a.service.run(EVENT, REQUESTER)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    const b = build();
    b.namesOf.mockRejectedValue(new Error('depot down'));
    await expect(b.service.run(EVENT, REQUESTER, [ENTITY])).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    const c = build();
    (c.directory.staffIdsByRoles as jest.Mock).mockRejectedValue(new Error('auth down'));
    await expect(c.service.run(EVENT, REQUESTER)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect([a.repo.records, b.repo.records, c.repo.records].map((r) => r.length)).toEqual([
      0, 0, 0,
    ]);
  });

  it('refuses with 503 when a recipient could not be told, yet keeps the others for the retry to complete', async () => {
    const { service, repo } = build();
    const record = repo.recordOnce.bind(repo);
    let first = true;
    jest.spyOn(repo, 'recordOnce').mockImplementation(async (row) => {
      if (first) {
        first = false;
        throw new Error('db down');
      }
      return record(row);
    });
    await expect(service.run(EVENT, REQUESTER)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repo.records).toHaveLength(1);
    await expect(service.run(EVENT, REQUESTER)).resolves.toMatchObject({ notified: 2 });
    expect(repo.records).toHaveLength(2);
  });
});

describe('the hourly cap', () => {
  const event = (n: number) =>
    `ai-access-request:${String(n).padStart(8, '0')}-8b7a-4f60-9e21-5c4b3a291807`;

  it('lets one requester raise three requests an hour, then answers 200 capped with nothing sent', async () => {
    const { service, repo } = build();
    for (const n of [1, 2, 3])
      await expect(service.run(event(n), REQUESTER)).resolves.toMatchObject({ notified: 2 });
    await expect(service.run(event(4), REQUESTER)).resolves.toEqual({
      recipients: 2,
      notified: 0,
      capped: true,
      whatsapp: 'pending',
    });
    expect(repo.records).toHaveLength(6);
  });

  it('does not count a retry of a request already filed, so a retry still finishes its recipients', async () => {
    const { service, repo } = build();
    for (const n of [1, 2, 3]) await service.run(event(n), REQUESTER);
    await expect(service.run(event(3), REQUESTER)).resolves.toMatchObject({ notified: 2 });
    expect(repo.records).toHaveLength(6);
  });

  const requester = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
  it('counts each requester on their own, and thirty requests overall', async () => {
    const { service, repo } = build();
    for (let n = 1; n <= 30; n += 1) {
      STAFF[requester(n)] = { fullName: 'Staf', role: 'MANAGER' };
      await expect(service.run(event(n), requester(n))).resolves.toMatchObject({ notified: 2 });
    }
    STAFF[requester(31)] = { fullName: 'Staf', role: 'MANAGER' };
    await expect(service.run(event(31), requester(31))).resolves.toMatchObject({
      notified: 0,
      capped: true,
    });
    expect(repo.records).toHaveLength(60);
  });

  it('counts one eventId reused by other requesters as new requests, up to the overall cap, and still completes a true retry', async () => {
    const { service, repo } = build();
    for (let n = 1; n <= 30; n += 1) {
      STAFF[requester(n)] = { fullName: 'Staf', role: 'MANAGER' };
      await expect(service.run(event(1), requester(n))).resolves.toMatchObject({ notified: 2 });
    }
    STAFF[requester(31)] = { fullName: 'Staf', role: 'MANAGER' };
    await expect(service.run(event(1), requester(31))).resolves.toMatchObject({
      notified: 0,
      capped: true,
    });
    await expect(service.run(event(1), requester(7))).resolves.toMatchObject({ notified: 2 });
    expect(repo.records).toHaveLength(60);
  });

  it('does not count a request that was refused as unknown, and says 503 when the recent requests cannot be read', async () => {
    const { service, repo } = build();
    for (const n of [1, 2, 3, 4]) await service.run(event(n), ENTITY);
    await expect(service.run(event(5), REQUESTER)).resolves.toMatchObject({ notified: 2 });
    jest.spyOn(repo, 'dedupeKeysSince').mockRejectedValue(new Error('db down'));
    await expect(service.run(event(6), REQUESTER)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('NotificationExternalController.aiAccessRequested', () => {
  it('hands the service one spelling of every id, so an upper-case retry is the same event', async () => {
    const run = jest.fn(async () => ({ recipients: 1, notified: 1, whatsapp: 'pending' as const }));
    const controller = new NotificationExternalController(
      {} as never,
      {} as never,
      { run } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await controller.aiAccessRequested({
      eventId: EVENT.toUpperCase().replace('AI-ACCESS-REQUEST', 'ai-access-request'),
      requesterAccountId: REQUESTER.toUpperCase(),
      legalEntityIds: [ENTITY.toUpperCase()],
      group: 'hr',
    });
    expect(run).toHaveBeenCalledWith(EVENT, REQUESTER, [ENTITY], 'hr');
    await controller.aiAccessRequested({ eventId: EVENT, requesterAccountId: REQUESTER });
    expect(run).toHaveBeenLastCalledWith(EVENT, REQUESTER, undefined, undefined);
  });
});

describe('the directory and entity adapters', () => {
  const config = {
    authServiceUrl: 'http://auth',
    depotServiceUrl: 'http://depot',
    internalServiceKey: 'k',
  } as never;

  it('reads one account profile, name null when blank, and null for an account the answer lacks', async () => {
    const answer = (rows: unknown) =>
      (global.fetch = jest.fn(async () => ({ ok: true, json: async () => rows })) as never);
    const adapter = new ApproverDirectoryHttpAdapter(config);
    answer([{ id: 'a', fullName: 'Budi', role: 'FINANCE' }]);
    expect(await adapter.profileOf('a')).toEqual({ fullName: 'Budi', role: 'FINANCE' });
    answer([{ id: 'a', fullName: '  ', role: 'FINANCE' }]);
    expect(await adapter.profileOf('a')).toEqual({ fullName: null, role: 'FINANCE' });
    answer([{ id: 'a', role: 'FINANCE', status: 'SUSPENDED' }]);
    expect(await adapter.profileOf('a')).toBeNull();
    answer([{ id: 'a', role: 'FINANCE', status: 'ACTIVE' }]);
    expect(await adapter.profileOf('a')).toEqual({ fullName: null, role: 'FINANCE' });
    answer([{ id: 'b', role: 'FINANCE' }, null, { id: 'a', role: 7 }]);
    expect(await adapter.profileOf('a')).toBeNull();
    answer({ not: 'a list' });
    expect(await adapter.profileOf('a')).toBeNull();
  });

  it('asks depot-service for each entity name, skips an unknown entity and throws when it cannot ask', async () => {
    const adapter = new LegalEntityNamesHttpAdapter(config);
    const urls: string[] = [];
    global.fetch = jest.fn(async (url: string) => {
      urls.push(url);
      if (url.endsWith('/gone')) return { ok: false, status: 404 };
      if (url.endsWith('/blank')) return { ok: true, json: async () => ({ name: ' ' }) };
      return { ok: true, json: async () => ({ name: ' Indowater ' }) };
    }) as never;
    expect(await adapter.namesOf(['e1', 'gone', 'blank'])).toEqual(['Indowater']);
    expect(urls[0]).toBe('http://depot/api/v1/legal-entities/internal/e1');
    global.fetch = jest.fn(async () => ({ ok: false, status: 503 })) as never;
    await expect(adapter.namesOf(['e1'])).rejects.toThrow(/503/);
    await expect(
      new LegalEntityNamesHttpAdapter({
        depotServiceUrl: '',
        internalServiceKey: '',
      } as never).namesOf(['e1']),
    ).rejects.toThrow(/missing/);
  });
});
