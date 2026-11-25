import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common';

import { CampaignService } from '../../src/application/services/campaign.service';
import { CampaignStatus } from '../../src/domain/campaign-status';
import { DraftSource } from '../../src/domain/draft-source';
import { AiSuggestionReusedError, NoRecipientsError } from '../../src/domain/errors';
import { AiDraftController, AiTokenOnlyGuard } from '../../src/modules/ai-draft.controller';
import {
  FakeActivitySegment,
  FakeBroadcastDelivery,
  FakeCustomerDirectory,
  InMemoryCampaignRepository,
} from '../support/fakes';

/** HD-17: the AI campaign draft at the service and controller seams (the HTTP path is in the e2e). */
const SUGGESTION = '5c1e2f3a-0000-4000-8000-0000000000a1';
const DEPOT = '00000000-0000-4000-8000-000000000001';
const input = () => ({ name: 'Promo', messageTemplate: 'Hai {{name}}', segment: {} });
const ai = { suggestionId: SUGGESTION, reason: 'Sepi pekan ini.' };

describe('CampaignService.draftFromAi', () => {
  let repo: InMemoryCampaignRepository;
  let directory: FakeCustomerDirectory;
  let activity: FakeActivitySegment;
  let delivery: FakeBroadcastDelivery;
  let service: CampaignService;

  beforeEach(() => {
    repo = new InMemoryCampaignRepository();
    directory = new FakeCustomerDirectory();
    activity = new FakeActivitySegment();
    delivery = new FakeBroadcastDelivery();
    directory.recipients = [{ customerId: 'c-1', name: 'Andi', phone: '+6281' }];
    activity.customerIds = ['c-1'];
    service = new CampaignService(repo, delivery, directory, activity);
  });

  it('makes a DRAFT marked AI, reads the audience as the depot rules do, and sends nothing', async () => {
    const { draft, replayed } = await service.draftFromAi('p-1', DEPOT, input(), ai);
    expect(replayed).toBe(false);
    expect(draft).toMatchObject({
      status: CampaignStatus.DRAFT,
      source: DraftSource.AI,
      aiSuggestionId: SUGGESTION,
      aiReason: 'Sepi pekan ini.',
      createdBy: 'p-1',
      totalRecipients: 1,
    });
    // The depot is the one the caller named, read as a service (the depot-campaign path).
    expect(activity.lastConditions).toMatchObject({ depotId: DEPOT });
    expect(directory.asService).toBe(true);
    expect(delivery.sent).toHaveLength(0);
  });

  it('answers the same draft for the same id and body, and refuses another body', async () => {
    const first = await service.draftFromAi('p-1', DEPOT, input(), ai);
    const again = await service.draftFromAi('p-1', DEPOT, input(), ai);
    expect(again.replayed).toBe(true);
    expect(again.draft.id).toBe(first.draft.id);
    for (const other of [
      { ...input(), name: 'Lain' },
      { ...input(), messageTemplate: 'Lain' },
      { ...input(), scheduledFor: new Date(Date.now() + 3_600_000) },
    ]) {
      await expect(service.draftFromAi('p-1', DEPOT, other, ai)).rejects.toBeInstanceOf(AiSuggestionReusedError);
    }
    await expect(service.draftFromAi('p-2', DEPOT, input(), ai)).rejects.toBeInstanceOf(AiSuggestionReusedError);
    await expect(
      service.draftFromAi('p-1', DEPOT, input(), { ...ai, reason: 'Lain.' }),
    ).rejects.toBeInstanceOf(AiSuggestionReusedError);
    expect(repo.campaigns).toHaveLength(1);
  });

  it('compares a schedule by its instant', async () => {
    const at = new Date(Date.now() + 3_600_000);
    await service.draftFromAi('p-1', DEPOT, { ...input(), scheduledFor: at }, ai);
    const again = await service.draftFromAi('p-1', DEPOT, { ...input(), scheduledFor: new Date(at) }, ai);
    expect(again.replayed).toBe(true);
  });

  it('answers the winner when two calls with one id race', async () => {
    const real = repo.findByAiSuggestionId.bind(repo);
    let calls = 0;
    // First look: nothing yet. The other call wins the insert, so the create fails and the second look finds it.
    jest.spyOn(repo, 'findByAiSuggestionId').mockImplementation(async (id) => (calls++ === 0 ? null : real(id)));
    await service.createForDepot('p-1', DEPOT, 'Promo', 'Hai {{name}}', {}, null, {
      source: DraftSource.AI,
      aiSuggestionId: SUGGESTION,
      aiReason: ai.reason,
    });
    jest.spyOn(repo, 'create').mockRejectedValueOnce(new Error('unique'));
    const raced = await service.draftFromAi('p-1', DEPOT, input(), ai);
    expect(raced.replayed).toBe(true);
  });

  it('rethrows when the create failed and nobody owns the id (no audience)', async () => {
    activity.customerIds = [];
    await expect(service.draftFromAi('p-1', DEPOT, input(), ai)).rejects.toBeInstanceOf(NoRecipientsError);
    expect(repo.campaigns).toHaveLength(0);
  });
});

describe('AiDraftController', () => {
  const ctx = (user: unknown) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as unknown as ExecutionContext;

  it('admits only the AI token', () => {
    const guard = new AiTokenOnlyGuard();
    expect(guard.canActivate(ctx({ via: 'ai' }))).toBe(true);
    for (const user of [undefined, {}, { via: 'machine' }]) {
      expect(() => guard.canActivate(ctx(user))).toThrow(ForbiddenException);
    }
  });

  it('needs a UUID suggestion id and lower-cases it', async () => {
    const draftFromAi = jest.fn().mockResolvedValue({
      draft: {
        id: 'c-1',
        name: 'Promo',
        channel: 'IN_APP',
        status: CampaignStatus.DRAFT,
        totalRecipients: 1,
        sentCount: 0,
        failedCount: 0,
        createdBy: 'p-1',
        createdAt: new Date(),
        sentAt: null,
        scheduledFor: null,
        source: DraftSource.AI,
        aiReason: 'r',
        aiSuggestionId: SUGGESTION,
        messageTemplate: 'Hai',
        recipients: [{ phone: '+6281' }],
      },
      replayed: false,
    });
    const controller = new AiDraftController({ draftFromAi } as unknown as CampaignService);
    const res = { status: jest.fn() };
    const dto = { depotId: DEPOT, name: 'Promo', messageTemplate: 'Hai', reason: 'r' };
    const user = { sub: 'p-1' } as never;
    for (const bad of [undefined, '', 'nope']) {
      await expect(controller.campaign(user, bad, dto as never, res as never)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    const out = await controller.campaign(user, SUGGESTION.toUpperCase(), dto as never, res as never);
    expect(draftFromAi.mock.calls[0]![3]).toEqual({ suggestionId: SUGGESTION, reason: 'r' });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(out).not.toHaveProperty('recipients');
    draftFromAi.mockResolvedValueOnce({ draft: { ...(await draftFromAi()).draft }, replayed: true });
    await controller.campaign(user, SUGGESTION, { ...dto, scheduledFor: '2030-01-01T00:00:00.000Z' } as never, res as never);
    expect(res.status).toHaveBeenLastCalledWith(200);
  });
});
