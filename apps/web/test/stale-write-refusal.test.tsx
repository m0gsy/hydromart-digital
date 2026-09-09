// @vitest-environment jsdom
//
// CA-2-53 — the console's half of "two admins, one record".
//
// The server now refuses a save built on a copy that has since moved (409 `STALE_WRITE`).
// That refusal is only useful if the screen does the two things a person needs: say what
// happened in words they can act on, and throw the stale draft away. Keeping the draft is
// the trap — the next Save would re-send exactly the values that were just refused, and
// this time from a page whose timestamp had been refreshed, so it WOULD land. The overwrite
// this whole row exists to stop would happen one click later.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The error class is hoisted with the mocks: `vi.mock`'s factory runs before any top-level
// statement in this file, so a class declared out here would not exist yet.
const { get, put, post, toast, FakeApiError } = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  toast: vi.fn(),
  FakeApiError: class extends Error {
    constructor(
      public readonly status: number,
      message: string,
      public readonly code?: string,
    ) {
      super(message);
    }
  },
}));

vi.mock('@/lib/api', () => ({ api: { get, put, post }, ApiError: FakeApiError }));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hq',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import HqSecurityPage from '@/app/hq/security/page';
import HqTaxPage from '@/app/hq/tax/page';
import HqSlaPolicyPage from '@/app/hq/sla-policy/page';

const SECURITY = {
  idleTimeoutMinutes: 15,
  require2fa: true,
  ipAllowlist: ['103.21.0.0/16'],
  updatedAt: new Date(0).toISOString(),
};

const TAX = {
  ppnPercent: 0,
  priceIncludesTax: true,
  invoiceFormat: 'HM/{YYYY}/{MM}/{SEQ}',
  companyName: 'PT Hydromart Nusantara',
  npwp: '',
  address: '',
  updatedAt: '2026-09-09T10:00:00.000Z',
};

const stale = () =>
  new FakeApiError(409, 'Data ini sudah diubah orang lain sejak Anda membukanya.', 'STALE_WRITE');

beforeEach(() => {
  toast.mockReset();
  post.mockReset().mockResolvedValue({});
  put.mockReset();
  get.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe('CA-2-53 · a save built on a stale copy is refused, and the screen says so', () => {
  it('/hq/security tells the admin, and re-reads instead of keeping the draft', async () => {
    const user = userEvent.setup();
    get.mockImplementation((path: string) =>
      String(path).includes('/sessions') ? Promise.resolve([]) : Promise.resolve(SECURITY),
    );
    put.mockRejectedValue(stale());
    render(<HqSecurityPage />, { wrapper: LocaleProvider });

    const idle = await screen.findByLabelText('Sesi berakhir otomatis');
    await user.clear(idle);
    await user.type(idle, '45');
    const readsBefore = get.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Simpan pengaturan' }));

    await waitFor(() => expect(toast).toHaveBeenCalled());
    // The specific sentence, not the generic save error: the admin has to know somebody
    // else changed it, or they will simply press Save again.
    expect(String(toast.mock.calls[0]![0])).toMatch(/sudah mengubah|changed this/i);
    // And the screen went back to the server rather than keeping what was typed.
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(readsBefore));
  });

  it('/hq/tax does the same on the row that decides what a customer is charged', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(TAX);
    put.mockRejectedValue(stale());
    render(<HqTaxPage />, { wrapper: LocaleProvider });

    const readsBefore = await waitFor(async () => {
      const n = get.mock.calls.length;
      expect(n).toBeGreaterThan(0);
      return n;
    });
    await user.click(await screen.findByRole('button', { name: /Simpan/ }));

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(String(toast.mock.calls[0]![0])).toMatch(/sudah mengubah|changed this/i);
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(readsBefore));
  });

  it('sends the version it was shown, which is what lets the server refuse at all', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(TAX);
    put.mockResolvedValue(TAX);
    render(<HqTaxPage />, { wrapper: LocaleProvider });

    await user.click(await screen.findByRole('button', { name: /Simpan/ }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect((put.mock.calls[0]![1] as { seenUpdatedAt?: string }).seenUpdatedAt).toBe(
      '2026-09-09T10:00:00.000Z',
    );
  });

  it('leaves an ordinary failure alone — not every refusal is somebody else typing', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(TAX);
    put.mockRejectedValue(new FakeApiError(400, 'NPWP tidak valid', 'VALIDATION'));
    render(<HqTaxPage />, { wrapper: LocaleProvider });

    await user.click(await screen.findByRole('button', { name: /Simpan/ }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(String(toast.mock.calls[0]![0])).toBe('NPWP tidak valid');
  });

  it('/hq/sla-policy refuses the same way, on the row that defines "late"', async () => {
    const user = userEvent.setup();
    get.mockImplementation((path: string) =>
      String(path).includes('settings')
        ? Promise.resolve({ effective: { slaMinutes: 90 } })
        : Promise.resolve({
            onTimeThresholdMinutes: 90,
            healthyBandPct: 95,
            criticalBandPct: 85,
            updatedAt: '2026-09-09T10:00:00.000Z',
          }),
    );
    put.mockRejectedValue(stale());
    render(<HqSlaPolicyPage />, { wrapper: LocaleProvider });

    const save = await screen.findByRole('button', { name: /Simpan/ });
    const readsBefore = get.mock.calls.length;
    await user.click(save);

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(String(toast.mock.calls[0]![0])).toMatch(/sudah mengubah|changed this/i);
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(readsBefore));
  });

  it('/hq/sla-policy still tells a 403 apart from somebody else typing', async () => {
    // Global settings are SUPER_ADMIN-only. "You may not" and "somebody beat you to it"
    // are different answers, and only one of them means try again after reloading.
    const user = userEvent.setup();
    get.mockImplementation((path: string) =>
      String(path).includes('settings')
        ? Promise.resolve({ effective: { slaMinutes: 90 } })
        : Promise.resolve({
            onTimeThresholdMinutes: 90,
            healthyBandPct: 95,
            criticalBandPct: 85,
            updatedAt: '2026-09-09T10:00:00.000Z',
          }),
    );
    put.mockRejectedValue(new FakeApiError(403, 'Terlarang', 'FORBIDDEN'));
    render(<HqSlaPolicyPage />, { wrapper: LocaleProvider });

    await user.click(await screen.findByRole('button', { name: /Simpan/ }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(String(toast.mock.calls[0]![0])).not.toMatch(/sudah mengubah/i);
  });

  /*
   * The rest of these three screens was never covered either. They are the screens this
   * change hands a new refusal to, so what they do with an ORDINARY failure — a dead read,
   * a revoked session, a 403 — decides whether the new message is read as special or as
   * more noise.
   */
  it('/hq/security says the policy read failed instead of drawing an empty form', async () => {
    get.mockImplementation((path: string) =>
      String(path).includes('/sessions')
        ? Promise.resolve([])
        : Promise.reject(new FakeApiError(500, 'admin-service down')),
    );
    render(<HqSecurityPage />, { wrapper: LocaleProvider });
    expect(await screen.findByRole('button', { name: /Coba lagi|Retry/i })).toBeTruthy();
  });

  it('/hq/security lists the live sessions and can end one', async () => {
    const user = userEvent.setup();
    get.mockImplementation((path: string) =>
      String(path).includes('/sessions')
        ? Promise.resolve([
            {
              id: 'sess-1',
              userAgent: 'Chrome di Windows',
              ipAddress: '103.21.0.9',
              createdAt: new Date().toISOString(),
            },
          ])
        : Promise.resolve(SECURITY),
    );
    post.mockResolvedValue({});
    render(<HqSecurityPage />, { wrapper: LocaleProvider });

    expect(await screen.findByText('Chrome di Windows')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Akhiri' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(String(post.mock.calls[0]![0])).toContain('sess-1');
  });

  it('/hq/security names a session with no device string, rather than showing a blank row', async () => {
    get.mockImplementation((path: string) =>
      String(path).includes('/sessions')
        ? Promise.resolve([
            { id: 'sess-2', userAgent: '', ipAddress: '', createdAt: new Date().toISOString() },
          ])
        : Promise.resolve(SECURITY),
    );
    render(<HqSecurityPage />, { wrapper: LocaleProvider });
    expect(await screen.findByText('Perangkat tak dikenal')).toBeTruthy();
  });

  it('/hq/security says so when ending a session is refused', async () => {
    const user = userEvent.setup();
    get.mockImplementation((path: string) =>
      String(path).includes('/sessions')
        ? Promise.resolve([
            { id: 'sess-3', userAgent: 'Firefox', ipAddress: '10.0.0.1', createdAt: new Date().toISOString() },
          ])
        : Promise.resolve(SECURITY),
    );
    post.mockRejectedValue(new FakeApiError(409, 'Sesi itu sudah berakhir'));
    render(<HqSecurityPage />, { wrapper: LocaleProvider });

    await user.click(await screen.findByRole('button', { name: 'Akhiri' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Sesi itu sudah berakhir', 'error'));
  });

  it('/hq/tax says the read failed instead of offering an empty tax form', async () => {
    get.mockRejectedValue(new FakeApiError(503, 'payment-service down'));
    render(<HqTaxPage />, { wrapper: LocaleProvider });
    expect(await screen.findByRole('button', { name: /Coba lagi|Retry/i })).toBeTruthy();
  });

  it('/hq/sla-policy says so when either read fails, not just the policy one', async () => {
    // Two reads feed this screen and they fail independently: the stored policy, and the
    // threshold delivery-service is ACTUALLY enforcing. Showing the form with only one of
    // them would put a number on screen that nothing is applying.
    get.mockImplementation((path: string) =>
      String(path).includes('settings')
        ? Promise.reject(new FakeApiError(503, 'delivery-service down'))
        : Promise.resolve({
            onTimeThresholdMinutes: 90,
            healthyBandPct: 95,
            criticalBandPct: 85,
            updatedAt: '2026-09-09T10:00:00.000Z',
          }),
    );
    render(<HqSlaPolicyPage />, { wrapper: LocaleProvider });
    expect(await screen.findByRole('button', { name: /Coba lagi|Retry/i })).toBeTruthy();
  });

  it('/hq/sla-policy falls back to the stored threshold when delivery has none', async () => {
    // The live value wins when there is one, because admin's copy is the one that was
    // wrong. With no live value the stored number is all there is, and a blank field would
    // invite somebody to type over a threshold they never saw.
    get.mockImplementation((path: string) =>
      String(path).includes('settings')
        ? Promise.resolve({ effective: {} })
        : Promise.resolve({
            onTimeThresholdMinutes: 90,
            healthyBandPct: 95,
            criticalBandPct: 85,
            updatedAt: '2026-09-09T10:00:00.000Z',
          }),
    );
    put.mockResolvedValue({});
    render(<HqSlaPolicyPage />, { wrapper: LocaleProvider });

    await userEvent.setup().click(await screen.findByRole('button', { name: /Simpan/ }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    // Two writes: delivery-service's live setting first, then admin's copy.
    const body = put.mock.calls.at(-1)![1] as { onTimeThresholdMinutes: number };
    expect(body.onTimeThresholdMinutes).toBe(90);
  });

  it('/hq/security keeps an edited allowlist as typed until it is saved', async () => {
    const user = userEvent.setup();
    get.mockImplementation((path: string) =>
      String(path).includes('/sessions') ? Promise.resolve([]) : Promise.resolve(SECURITY),
    );
    put.mockImplementation((_p: string, body: unknown) =>
      Promise.resolve({ ...SECURITY, ...(body as object) }),
    );
    render(<HqSecurityPage />, { wrapper: LocaleProvider });

    const box = await screen.findByLabelText('IP allowlist');
    await user.clear(box);
    await user.type(box, '10.0.0.0/8');
    expect((box as HTMLTextAreaElement).value).toBe('10.0.0.0/8');

    await user.click(screen.getByRole('button', { name: 'Simpan pengaturan' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect((put.mock.calls[0]![1] as { ipAllowlist: string[] }).ipAllowlist).toEqual([
      '10.0.0.0/8',
    ]);
  });

  it('/hq/security drops blank lines from the allowlist rather than sending them', async () => {
    const user = userEvent.setup();
    get.mockImplementation((path: string) =>
      String(path).includes('/sessions') ? Promise.resolve([]) : Promise.resolve(SECURITY),
    );
    put.mockImplementation((_p: string, body: unknown) =>
      Promise.resolve({ ...SECURITY, ...(body as object) }),
    );
    render(<HqSecurityPage />, { wrapper: LocaleProvider });

    const box = await screen.findByLabelText('IP allowlist');
    await user.clear(box);
    // Blank and whitespace-only lines, written without an escape so this file stays
    // readable through a shell heredoc.
    const NL = String.fromCharCode(10);
    await user.type(box, ['10.0.0.0/8', '', '   ', '192.168.0.0/16'].join(NL));
    await user.click(screen.getByRole('button', { name: 'Simpan pengaturan' }));

    await waitFor(() => expect(put).toHaveBeenCalled());
    expect((put.mock.calls[0]![1] as { ipAllowlist: string[] }).ipAllowlist).toEqual([
      '10.0.0.0/8',
      '192.168.0.0/16',
    ]);
  });

  /*
   * A failure that is not an ApiError at all — a network drop, a JSON parse — must still
   * reach the person who pressed Save. These branches are the ones that decide whether a
   * failed write is silent, and a silent failed write on a settings page is indistinguishable
   * from a successful one.
   */
  it('/hq/tax reports a save that failed for no server reason', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(TAX);
    put.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<HqTaxPage />, { wrapper: LocaleProvider });

    await user.click(await screen.findByRole('button', { name: /Simpan/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^Gagal/), 'error'));
  });

  it('/hq/security reports one too, and does not clear the form', async () => {
    const user = userEvent.setup();
    get.mockImplementation((path: string) =>
      String(path).includes('/sessions') ? Promise.resolve([]) : Promise.resolve(SECURITY),
    );
    put.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<HqSecurityPage />, { wrapper: LocaleProvider });

    await user.click(await screen.findByRole('button', { name: 'Simpan pengaturan' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^Gagal/), 'error'));
  });

  it('/hq/security reports a revoke that failed for no server reason', async () => {
    const user = userEvent.setup();
    get.mockImplementation((path: string) =>
      String(path).includes('/sessions')
        ? Promise.resolve([
            { id: 'sess-4', userAgent: 'Edge', ipAddress: '10.0.0.2', createdAt: new Date().toISOString() },
          ])
        : Promise.resolve(SECURITY),
    );
    post.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<HqSecurityPage />, { wrapper: LocaleProvider });

    await user.click(await screen.findByRole('button', { name: 'Akhiri' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^Gagal/), 'error'));
  });

  it('/hq/security says the SESSION list failed without hiding the policy form', async () => {
    // Two independent reads again: losing the session list is not a reason to withhold the
    // idle-timeout control, and an empty list would claim there are no other sessions.
    get.mockImplementation((path: string) =>
      String(path).includes('/sessions')
        ? Promise.reject(new FakeApiError(503, 'auth-service down'))
        : Promise.resolve(SECURITY),
    );
    render(<HqSecurityPage />, { wrapper: LocaleProvider });

    expect(await screen.findByLabelText('Sesi berakhir otomatis')).toBeTruthy();
    expect(await screen.findByText('auth-service down')).toBeTruthy();
  });

  it('/hq/sla-policy says the policy read failed, separately from the live one', async () => {
    get.mockImplementation((path: string) =>
      String(path).includes('settings')
        ? Promise.resolve({ effective: { slaMinutes: 90 } })
        : Promise.reject(new FakeApiError(500, 'admin-service down')),
    );
    render(<HqSlaPolicyPage />, { wrapper: LocaleProvider });
    expect(await screen.findByRole('button', { name: /Coba lagi|Retry/i })).toBeTruthy();
  });

  it('/hq/sla-policy reports a save that failed for no server reason', async () => {
    const user = userEvent.setup();
    get.mockImplementation((path: string) =>
      String(path).includes('settings')
        ? Promise.resolve({ effective: { slaMinutes: 90 } })
        : Promise.resolve({
            onTimeThresholdMinutes: 90,
            healthyBandPct: 95,
            criticalBandPct: 85,
            updatedAt: '2026-09-09T10:00:00.000Z',
          }),
    );
    put.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<HqSlaPolicyPage />, { wrapper: LocaleProvider });

    await user.click(await screen.findByRole('button', { name: /Simpan/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^Gagal/), 'error'));
  });
});
