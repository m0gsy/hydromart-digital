import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError, primeAppHeaders } from '@/lib/api';

function mockFetch(status: number, body: unknown) {
  return vi.fn(
    async (_url?: string, _init?: RequestInit) =>
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('flattens a NestJS validation error array into one message', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(400, { message: ['phone must not be empty', 'code too short'] }),
    );
    await expect(api.get('/x')).rejects.toMatchObject({
      status: 400,
      message: 'phone must not be empty, code too short',
    } satisfies Partial<ApiError>);
  });

  // B-13: checkout and the counter till pass an Idempotency-Key this way. If the client
  // drops it, the server-side guard never sees a key and protects nothing.
  it('sends caller-supplied headers alongside the JSON content type', async () => {
    const fetchMock = mockFetch(201, { id: 'o1' });
    vi.stubGlobal('fetch', fetchMock);

    await api.post('/orders/api/v1/orders/checkout', { a: 1 }, true, {
      'Idempotency-Key': 'attempt-1',
    });

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      'Content-Type': 'application/json',
      'Idempotency-Key': 'attempt-1',
    });
  });

  it('returns undefined for 204 No Content', async () => {
    vi.stubGlobal('fetch', mockFetch(204, null));
    await expect(api.del('/orders/api/v1/cart')).resolves.toBeUndefined();
  });

  it('maps a network failure to a status-0 ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('failed to fetch');
      }),
    );
    await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError);
    await expect(api.get('/x')).rejects.toHaveProperty('status', 0);
  });

  // DELETE overload (settings reset needs a JSON body; every other caller passes
  // just `auth` — both call shapes must keep working through the same function).
  it('del(path, true) sends no body (existing callers)', async () => {
    const fetchMock = mockFetch(204, null);
    vi.stubGlobal('fetch', fetchMock);
    await api.del('/x', true);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init).toMatchObject({ method: 'DELETE', body: undefined });
  });

  it('del(path, body, true) sends the body as JSON', async () => {
    const fetchMock = mockFetch(204, null);
    vi.stubGlobal('fetch', fetchMock);
    await api.del('/x', { scope: 'GLOBAL', key: 'k' }, true);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init).toMatchObject({
      method: 'DELETE',
      body: JSON.stringify({ scope: 'GLOBAL', key: 'k' }),
    });
  });
});

// The four messages `api.ts` writes itself, i.e. when the server said nothing usable.
// They were English literals in a module no translator ever read, so a courier who lost
// signal was answered in English under `lang="id"`. Indonesian is the bundled default.
describe('messages the client writes itself', () => {
  it('a dropped connection is reported in Indonesian', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(api.get('/anything')).rejects.toMatchObject({
      status: 0,
      message: 'Tidak bisa menghubungi server. Periksa koneksimu lalu coba lagi.',
    });
  });

  it('an unexplained status carries the number, interpolated', async () => {
    vi.stubGlobal('fetch', mockFetch(503, {}));
    await expect(api.get('/anything')).rejects.toMatchObject({
      status: 503,
      message: 'Permintaan gagal (503).',
    });
  });
});

// E6: the server answers in English with a machine code beside it. Every screen that
// shows `err.message` was showing that English. The mapping lives here, once, so a
// screen does not have to know a code exists.
describe('E6 · named server errors are answered in Indonesian', () => {
  const cases: Array<[string, number, string, string]> = [
    [
      'AUTH_CUSTOMER_NOT_FOUND',
      404,
      'No account is registered with this phone number.',
      'Nomor ini belum terdaftar.',
    ],
    [
      'AUTH_INVALID_PHONE',
      422,
      '"abc" is not a valid Indonesian mobile number.',
      'Nomor HP Indonesia tidak valid. Contoh: 081234567890.',
    ],
    [
      'AUTH_PHONE_TAKEN',
      409,
      'This phone number is already registered.',
      'Nomor ini sudah terdaftar. Silakan masuk.',
    ],
    [
      'AUTH_EMAIL_TAKEN',
      409,
      'This email address is already registered.',
      'Email ini sudah dipakai akun lain.',
    ],
    [
      'AUTH_OTP_INVALID',
      401,
      'The verification code is invalid or has expired.',
      'Kode verifikasi salah.',
    ],
    [
      'AUTH_OTP_EXPIRED',
      401,
      'The verification code has expired.',
      'Kode verifikasi sudah kedaluwarsa. Minta kode baru.',
    ],
    [
      'AUTH_OTP_MAX_ATTEMPTS',
      429,
      'Too many incorrect attempts. Please request a new code.',
      'Terlalu banyak percobaan. Minta kode baru.',
    ],
    [
      'AUTH_ACCOUNT_NOT_ACTIVE',
      403,
      'This account is not active.',
      'Akun ini tidak aktif. Hubungi dukungan Hydromart.',
    ],
    /*
     * CA-3-05: its own code, because the answer is different. Suspended and deleted need a
     * human; a number that was registered and never verified needs a new OTP, and used to
     * be sent to the support queue by sharing a code with the other two.
     */
    [
      'AUTH_ACCOUNT_PENDING_VERIFICATION',
      403,
      'This number is registered but not verified yet.',
      'Nomor ini sudah terdaftar tapi belum diverifikasi. Kami kirim ulang kodenya.',
    ],
  ];

  it.each(cases)('%s is translated', async (code, status, english, indonesian) => {
    vi.stubGlobal('fetch', mockFetch(status, { statusCode: status, code, message: english }));
    await expect(api.get('/x')).rejects.toMatchObject({ status, code, message: indonesian });
  });

  it('keeps the code on the error so a screen can branch on it', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(429, { statusCode: 429, code: 'AUTH_OTP_COOLDOWN', message: 'Please wait 60s.' }),
    );
    await expect(api.get('/x')).rejects.toHaveProperty('code', 'AUTH_OTP_COOLDOWN');
  });

  it('leaves an unmapped code showing whatever the server said', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(422, {
        statusCode: 422,
        code: 'ORDER_SOMETHING_ELSE',
        message: 'Pesanan ditolak.',
      }),
    );
    await expect(api.get('/x')).rejects.toMatchObject({ message: 'Pesanan ditolak.' });
  });
});

// E3: `useQueryParam('id')` answers '' when the parameter is missing, and every detail
// screen in the app feeds that straight into an endpoint builder. The result is a URL
// with a hole in it — `/orders/api/v1/orders/` — which the server answers with a 404
// that reads as "this order does not exist" rather than "no order was named". Twenty-one
// screens build ids this way; the refusal belongs here, where all of them pass.
describe('E3 · a request with a missing path segment never leaves the client', () => {
  it('refuses a trailing empty segment', async () => {
    const fetchMock = mockFetch(200, {});
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.get('/orders/api/v1/orders/')).rejects.toMatchObject({
      status: 0,
      message: 'Halaman ini dibuka tanpa data yang diperlukan. Kembali lalu pilih ulang.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an empty segment in the middle', async () => {
    const fetchMock = mockFetch(200, {});
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.get('/hr/api/v1/employees//history')).rejects.toHaveProperty('status', 0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an empty segment sitting in front of a query string', async () => {
    const fetchMock = mockFetch(200, {});
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.get('/orders/api/v1/orders/?placed=1')).rejects.toHaveProperty('status', 0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves an empty QUERY value alone — that is a filter, not a hole', async () => {
    const fetchMock = mockFetch(200, { items: [] });
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.get('/auth/api/v1/staff?depotId=')).resolves.toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalled();
  });
});

/*
 * N9. The APK carries a FROZEN export, so a phone keeps the UI it was installed with until
 * somebody updates it. The risk that leaves is API skew against binaries in the field —
 * and nothing recorded which ones those are, so the compatibility floor was a guess.
 */
describe('every request says which binary is talking', () => {
  afterEach(() => primeAppHeaders(null));

  it('tags the request with the package and its build', async () => {
    primeAppHeaders({ id: 'id.hydromart.app', build: '1204' });
    const fetchMock = mockFetch(200, {});
    vi.stubGlobal('fetch', fetchMock);

    await api.get('/anything');

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-App-Id']).toBe('id.hydromart.app');
    expect(headers['X-App-Version']).toBe('1204');
  });

  // On the web there is no package and no build, and a header that identifies nothing is
  // just a byte on every request plus a series nobody can read.
  it('sends neither header when there is no binary to name', async () => {
    primeAppHeaders(null);
    const fetchMock = mockFetch(200, {});
    vi.stubGlobal('fetch', fetchMock);

    await api.get('/anything');

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-App-Id']).toBeUndefined();
    expect(headers['X-App-Version']).toBeUndefined();
  });
});
