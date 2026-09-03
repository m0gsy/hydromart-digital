import { Logger } from '@nestjs/common';

import { recordAuditEvent } from './audit-trail';

describe('recordAuditEvent (H-29)', () => {
  const config = { authServiceUrl: 'http://auth:3001/', internalServiceKey: 'k' };
  let logger: Logger;
  let error: jest.SpyInstance;

  beforeEach(() => {
    logger = new Logger('test');
    error = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('posts the event to the internal ingest route with the shared key', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true } as unknown as Response);

    await recordAuditEvent(
      config,
      {
        action: 'payment.refund.approved',
        actorId: 'user-1',
        target: 'PAY-1',
        metadata: { amountIdr: 250_000 },
      },
      logger,
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://auth:3001/api/v1/auth/audit/internal');
    expect((init.headers as Record<string, string>)['x-internal-key']).toBe('k');
    expect(JSON.parse(init.body as string)).toEqual({
      actorId: 'user-1',
      action: 'payment.refund.approved',
      target: 'PAY-1',
      success: true, // defaulted: an entry with no verdict is not a record of anything
      metadata: { amountIdr: 250_000 },
    });
    expect(error).not.toHaveBeenCalled();
  });

  it('carries success=false through — a refused approval is still a decision', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true } as unknown as Response);
    await recordAuditEvent(config, { action: 'a', success: false }, logger);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.success).toBe(false);
  });

  // Fail-open is the contract: auditing must not reject money that already moved. The
  // trade is that a dropped entry is a hole in the record, so it must be loud.
  it('never throws, and says loudly that the entry was lost', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 503 } as Response);
    await expect(
      recordAuditEvent(config, { action: 'payment.refund.approved', target: 'PAY-9' }, logger),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('was NOT recorded'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('PAY-9'));

    error.mockClear();
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(recordAuditEvent(config, { action: 'a' }, logger)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
  });

  it('stays silent and sends nothing when the trail is not configured', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await recordAuditEvent(
      { authServiceUrl: '', internalServiceKey: 'k' },
      { action: 'a' },
      logger,
    );
    await recordAuditEvent(
      { authServiceUrl: 'http://auth:3001', internalServiceKey: '' },
      { action: 'a' },
      logger,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
