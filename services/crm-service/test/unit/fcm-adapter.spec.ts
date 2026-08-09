import { generateKeyPairSync } from 'node:crypto';

import { CrmConfigService } from '../../src/config/crm-config.service';
import { WebPushSubscriptionRecord } from '../../src/application/ports/push.repository';
import { FCM_PREFIX, FcmSenderAdapter } from '../../src/infrastructure/fcm/fcm.sender.adapter';
import { CompositePushSender } from '../../src/infrastructure/push/composite-push.sender';
import { WebPushSenderAdapter } from '../../src/infrastructure/webpush/web-push.sender.adapter';

// F4. The REAL FCM HTTP v1 adapter — a genuine RS256 signature over a real generated key,
// against a mocked `fetch`. What is being proved is the shape of the exchange (JWT grant →
// access token → messages:send), the token cache, and the two answers that mean "this
// device is gone" as opposed to "this send failed", because only one of them deletes a
// subscription row.

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://fcm.googleapis.com/v1/projects/hydromart-test/messages:send';

const fetchMock = jest.fn();

function res(status: number, body?: unknown): { status: number; text: () => Promise<string> } {
  return { status, text: async () => (body === undefined ? '' : JSON.stringify(body)) };
}

function config(
  over: Partial<{ projectId: string; clientEmail: string; privateKey: string }> = {},
) {
  return {
    fcm: {
      projectId: 'hydromart-test',
      clientEmail: 'push@hydromart-test.iam.gserviceaccount.com',
      privateKey,
      ...over,
    },
  } as unknown as CrmConfigService;
}

const SUB: WebPushSubscriptionRecord = {
  id: 's1',
  customerId: 'c1',
  endpoint: `${FCM_PREFIX}DEVICE-TOKEN`,
  p256dh: '',
  auth: '',
};

const PAYLOAD = { title: 'Pesanan dikirim', body: 'Kurir sedang menuju lokasi', url: '/orders' };

/** Answer the OAuth exchange, then whatever the send should return. */
function grantThen(sendResponse: ReturnType<typeof res>): void {
  fetchMock.mockImplementation(async (url: string) =>
    url === TOKEN_URL ? res(200, { access_token: 'ya29.TEST', expires_in: 3600 }) : sendResponse,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
});

describe('FcmSenderAdapter — disabled', () => {
  it.each([
    ['no project', { projectId: '' }],
    ['no client email', { clientEmail: '' }],
    ['no private key', { privateKey: '' }],
  ])('is a no-op with %s, and never calls out', async (_label, over) => {
    const sent = await new FcmSenderAdapter(config(over)).send(SUB, PAYLOAD);
    expect(sent).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('FcmSenderAdapter — sending', () => {
  it('exchanges a signed JWT for an access token, then posts the message', async () => {
    grantThen(res(200, { name: 'projects/hydromart-test/messages/1' }));

    expect(await new FcmSenderAdapter(config()).send(SUB, PAYLOAD)).toEqual({ ok: true });

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe(TOKEN_URL);
    const form = new URLSearchParams(tokenInit.body as string);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    // header.claims.signature, and the claims are the ones Google requires.
    const assertion = form.get('assertion')!.split('.');
    expect(assertion).toHaveLength(3);
    expect(JSON.parse(Buffer.from(assertion[1], 'base64url').toString())).toMatchObject({
      iss: 'push@hydromart-test.iam.gserviceaccount.com',
      aud: TOKEN_URL,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    });

    const [sendUrl, sendInit] = fetchMock.mock.calls[1];
    expect(sendUrl).toBe(SEND_URL);
    expect((sendInit.headers as Record<string, string>).Authorization).toBe('Bearer ya29.TEST');
    // The `fcm:` prefix is a storage detail and must not travel to Google.
    expect(JSON.parse(sendInit.body as string)).toEqual({
      message: {
        token: 'DEVICE-TOKEN',
        notification: { title: PAYLOAD.title, body: PAYLOAD.body },
        data: { url: '/orders' },
      },
    });
  });

  it('sends an empty data object when the payload carries no url', async () => {
    grantThen(res(200, {}));
    await new FcmSenderAdapter(config()).send(SUB, { title: 'a', body: 'b' });
    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(body.message.data).toEqual({});
  });

  it('reuses the access token across sends rather than minting one per message', async () => {
    grantThen(res(200, {}));
    const adapter = new FcmSenderAdapter(config());
    await adapter.send(SUB, PAYLOAD);
    await adapter.send(SUB, PAYLOAD);

    expect(fetchMock.mock.calls.filter(([url]) => url === TOKEN_URL)).toHaveLength(1);
  });

  it('treats an endpoint that is only the prefix as gone', async () => {
    const sent = await new FcmSenderAdapter(config()).send(
      { ...SUB, endpoint: FCM_PREFIX },
      PAYLOAD,
    );
    expect(sent).toEqual({ ok: false, gone: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('FcmSenderAdapter — what counts as "gone"', () => {
  it('prunes on a 404 NOT_FOUND', async () => {
    grantThen(
      res(404, { error: { status: 'NOT_FOUND', message: 'Requested entity was not found.' } }),
    );
    expect(await new FcmSenderAdapter(config()).send(SUB, PAYLOAD)).toEqual({
      ok: false,
      gone: true,
    });
  });

  it('prunes on a 400 whose details say UNREGISTERED', async () => {
    grantThen(
      res(400, {
        error: { status: 'INVALID_ARGUMENT', details: [{ errorCode: 'UNREGISTERED' }] },
      }),
    );
    expect(await new FcmSenderAdapter(config()).send(SUB, PAYLOAD)).toEqual({
      ok: false,
      gone: true,
    });
  });

  /**
   * The distinction that matters: a malformed payload is also a 400, and deleting the
   * subscription for it would silently unsubscribe a working device over a bug of ours.
   */
  it('does NOT prune on a 400 that is merely a bad message', async () => {
    grantThen(res(400, { error: { status: 'INVALID_ARGUMENT', message: 'Invalid JSON payload' } }));
    expect(await new FcmSenderAdapter(config()).send(SUB, PAYLOAD)).toEqual({ ok: false });
  });

  it('does not prune on a 500, and does not throw', async () => {
    grantThen(res(500, { error: { status: 'INTERNAL' } }));
    expect(await new FcmSenderAdapter(config()).send(SUB, PAYLOAD)).toEqual({ ok: false });
  });

  it('survives a body that is not JSON at all', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === TOKEN_URL
        ? res(200, { access_token: 'ya29.TEST', expires_in: 3600 })
        : { status: 502, text: async () => '<html>bad gateway</html>' },
    );
    expect(await new FcmSenderAdapter(config()).send(SUB, PAYLOAD)).toEqual({ ok: false });
  });
});

describe('FcmSenderAdapter — credential failures', () => {
  it('drops the cached token on a 401 so the next send re-mints it', async () => {
    grantThen(res(401, { error: { status: 'UNAUTHENTICATED' } }));
    const adapter = new FcmSenderAdapter(config());
    await adapter.send(SUB, PAYLOAD);
    await adapter.send(SUB, PAYLOAD);

    expect(fetchMock.mock.calls.filter(([url]) => url === TOKEN_URL)).toHaveLength(2);
  });

  it('reports an unusable private key without throwing', async () => {
    const adapter = new FcmSenderAdapter(config({ privateKey: 'not-a-pem' }));
    expect(await adapter.send(SUB, PAYLOAD)).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives up quietly when the token exchange is rejected', async () => {
    fetchMock.mockResolvedValue(res(400, { error: 'invalid_grant' }));
    expect(await new FcmSenderAdapter(config()).send(SUB, PAYLOAD)).toEqual({ ok: false });
    // No message attempt without a token.
    expect(fetchMock.mock.calls.filter(([url]) => url === SEND_URL)).toHaveLength(0);
  });

  it('gives up quietly when the token exchange answers 200 with no token', async () => {
    fetchMock.mockResolvedValue(res(200, {}));
    expect(await new FcmSenderAdapter(config()).send(SUB, PAYLOAD)).toEqual({ ok: false });
  });

  it('defaults the token lifetime when Google omits expires_in', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === TOKEN_URL ? res(200, { access_token: 'ya29.TEST' }) : res(200, {}),
    );
    const adapter = new FcmSenderAdapter(config());
    await adapter.send(SUB, PAYLOAD);
    await adapter.send(SUB, PAYLOAD);
    expect(fetchMock.mock.calls.filter(([url]) => url === TOKEN_URL)).toHaveLength(1);
  });

  it('survives an unreachable Google on the token exchange', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await new FcmSenderAdapter(config()).send(SUB, PAYLOAD)).toEqual({ ok: false });
  });

  it('treats an empty 200 body as no token rather than as success', async () => {
    fetchMock.mockResolvedValue(res(200));
    expect(await new FcmSenderAdapter(config()).send(SUB, PAYLOAD)).toEqual({ ok: false });
  });

  /**
   * The deadline is only half a fix if nothing fires it — `fetch` has no timeout of its
   * own, so a Google that accepts the connection and never answers would hold a send
   * open for as long as it liked, and `PushService` awaits every one of them.
   */
  it('aborts a request that outlives the deadline', async () => {
    jest.useFakeTimers();
    let aborted = false;
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    );

    const sending = new FcmSenderAdapter(config()).send(SUB, PAYLOAD);
    await jest.advanceTimersByTimeAsync(10_000);

    expect(aborted).toBe(true);
    expect(await sending).toEqual({ ok: false });
    jest.useRealTimers();
  });

  it('survives an unreachable Google on the send itself', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === TOKEN_URL) return res(200, { access_token: 'ya29.TEST', expires_in: 3600 });
      throw new Error('socket hang up');
    });
    expect(await new FcmSenderAdapter(config()).send(SUB, PAYLOAD)).toEqual({ ok: false });
  });
});

describe('CompositePushSender', () => {
  const webPush = { send: jest.fn(async () => ({ ok: true })) };
  const fcm = { send: jest.fn(async () => ({ ok: true })) };
  const composite = new CompositePushSender(
    webPush as unknown as WebPushSenderAdapter,
    fcm as unknown as FcmSenderAdapter,
  );

  beforeEach(() => {
    webPush.send.mockClear();
    fcm.send.mockClear();
  });

  it('routes an fcm: endpoint to FCM', async () => {
    await composite.send(SUB, PAYLOAD);
    expect(fcm.send).toHaveBeenCalled();
    expect(webPush.send).not.toHaveBeenCalled();
  });

  it('routes a browser endpoint to Web Push', async () => {
    await composite.send({ ...SUB, endpoint: 'https://fcm.googleapis.com/wp/abc' }, PAYLOAD);
    expect(webPush.send).toHaveBeenCalled();
    expect(fcm.send).not.toHaveBeenCalled();
  });

  /**
   * The browser's own Web Push endpoint is hosted at fcm.googleapis.com, so routing on
   * the host instead of the prefix would send every Chrome subscription to the wrong
   * transport — and fail as a 400 that looks like any other 400.
   */
  it('does not confuse a Chrome endpoint with an FCM registration', () => {
    expect(FcmSenderAdapter.owns('https://fcm.googleapis.com/fcm/send/abc')).toBe(false);
    expect(FcmSenderAdapter.owns(`${FCM_PREFIX}abc`)).toBe(true);
  });
});
