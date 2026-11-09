import { PolicyChangeController } from '../../src/modules/policy-change.controller';

describe('PolicyChangeController (AAS-14)', () => {
  const rec = (over = {}) => ({
    id: 'pc-1', kind: 'SECURITY_POLICY', targetId: null, payload: {}, status: 'PENDING',
    requestedBy: 'su-1', requestedAt: new Date(0), decidedBy: null, decidedAt: null, decisionNote: null, ...over,
  });
  const changes = { list: jest.fn(), approve: jest.fn(), reject: jest.fn() };
  const controller = new PolicyChangeController(changes as never);
  const user = { sub: 'su-2' } as never;
  beforeEach(() => jest.clearAllMocks());

  it('lists by status', async () => {
    changes.list.mockResolvedValue([rec()]);
    expect(await controller.list({ status: 'PENDING' })).toHaveLength(1);
    expect(changes.list).toHaveBeenCalledWith('PENDING');
  });

  it('approve and reject pass the decider and the note', async () => {
    changes.approve.mockResolvedValue(rec({ status: 'APPLIED' }));
    changes.reject.mockResolvedValue(rec({ status: 'REJECTED' }));
    expect((await controller.approve('pc-1', { note: 'ok' }, user)).status).toBe('APPLIED');
    expect(changes.approve).toHaveBeenCalledWith('pc-1', 'su-2', 'ok');
    expect((await controller.reject('pc-1', {}, user)).status).toBe('REJECTED');
    expect(changes.reject).toHaveBeenCalledWith('pc-1', 'su-2', null);
  });
});
