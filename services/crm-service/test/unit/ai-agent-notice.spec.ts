import { ServiceUnavailableException } from '@nestjs/common';

import { AiAgentNoticeService } from '../../src/application/services/ai-agent-notice.service';
import { NotificationEvent } from '../../src/domain/notification-event';

const DTO = { eventId: 'e1', agentId: 'stok', agentName: 'Stok', kind: 'CAP_REACHED' as const };

function build(over: { origin?: string; notify?: jest.Mock; ids?: jest.Mock } = {}) {
  const notify = over.notify ?? jest.fn(async () => ({}));
  const staffIdsByRoles = over.ids ?? jest.fn(async () => ['a', 'b']);
  const directory = {
    staffIdsByRoles,
    // b left the AI team's managers after the id read
    rolesOf: jest.fn(async () => new Map([['a', 'DIREKTUR'], ['b', 'MANAGER']])),
    profileOf: jest.fn(),
  };
  const service = new AiAgentNoticeService({ notify } as never, { aiWebUrl: over.origin ?? 'https://ai.test' } as never, directory as never);
  return { service, notify, staffIdsByRoles };
}

describe('AiAgentNoticeService', () => {
  it('files the kind\'s event for each remaining manager, keyed by event and person', async () => {
    const { service, notify, staffIdsByRoles } = build();
    expect(await service.run(DTO)).toEqual({ recipients: 1, notified: 1, whatsapp: 'pending' });
    expect(notify).toHaveBeenCalledWith(
      NotificationEvent.AI_AGENT_CAP,
      '',
      { who: 'Agen Stok', link: 'https://ai.test/tim-ai/stok' },
      'a',
      null,
      'e1:a',
    );
    expect(staffIdsByRoles.mock.calls[0]![0]).toEqual(expect.arrayContaining(['DIREKTUR', 'SUPER_ADMIN']));
  });

  it('answers 503 without AI_WEB_URL, when the directory is down, and when a recipient could not be filed', async () => {
    await expect(build({ origin: 'http://insecure' }).service.run(DTO)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(build({ ids: jest.fn().mockRejectedValue(new Error('auth down')) }).service.run(DTO)).rejects.toThrow(/could not be read/);
    await expect(build({ notify: jest.fn().mockRejectedValue(new Error('db')) }).service.run(DTO)).rejects.toThrow(/could not be told/);
  });
});
