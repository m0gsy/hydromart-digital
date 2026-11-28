// @vitest-environment jsdom
//
// HD-12/HD-13, PR-C. The customer opt-in card, the cashier QR panel and /hq/whatsapp. All three stay
// hidden while the server says WhatsApp is off, and none of them can send a message.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, put, toast, confirm, openExternal, auth } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  openExternal: vi.fn(),
  auth: { role: 'SUPER_ADMIN' },
}));

vi.mock('@/lib/api', () => ({
  api: { get, post, put },
  ApiError: class extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/confirm', () => ({ useConfirm: () => ({ confirm }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { id: 'me', role: auth.role } }) }));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}|${Object.values(p).join('|')}` : k) }),
}));
vi.mock('@/lib/platform', async (orig) => ({ ...(await orig<object>()), openExternal }));
vi.mock('@/lib/wa-qr', () => ({ qrPath: async () => ({ size: 21, d: 'M0 0h1v1h-1z' }) }));

import { CounterWaOptIn } from '@/components/dashboard/counter-wa-optin';
import { WaOptInCard } from '@/components/wa-opt-in-card';
import HqWhatsappPage from '@/app/hq/whatsapp/page';

const on = { enabled: true };
const off = { enabled: false };

/** Route GETs by URL ending, the way the app's endpoints are laid out. */
function serve(routes: Record<string, unknown>) {
  get.mockImplementation(async (path: string) => {
    for (const [suffix, body] of Object.entries(routes)) {
      if (path.endsWith(suffix)) {
        if (body instanceof Error) throw body;
        return body;
      }
    }
    throw new Error(`unexpected GET ${path}`);
  });
}

beforeEach(() => {
  for (const m of [get, post, put, toast, confirm, openExternal]) m.mockReset();
  auth.role = 'SUPER_ADMIN';
});
afterEach(() => vi.useRealTimers());

describe('WaOptInCard (customer account)', () => {
  it('renders nothing while WhatsApp is off, and never asks for the state', async () => {
    serve({ '/whatsapp/status': off });
    const { container } = render(<WaOptInCard />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(container.textContent).toBe('');
    expect(get).not.toHaveBeenCalledWith('/crm/api/v1/whatsapp/me', true);
  });

  it('renders nothing when the status call fails (an older server)', async () => {
    serve({ '/whatsapp/status': new Error('404') });
    const { container } = render(<WaOptInCard />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('NONE: connects by making a code and opening wa.me; the customer presses send', async () => {
    serve({ '/whatsapp/status': on, '/whatsapp/me': { state: 'NONE', phone: null } });
    post.mockResolvedValue({ id: 'c1', code: 'ABCD2345', expiresAt: 'x', link: 'https://wa.me/62811?text=DAFTAR%20ABCD2345' });
    openExternal.mockReturnValue(true);
    render(<WaOptInCard />);
    await userEvent.click(await screen.findByText('wa.card.connect'));
    await waitFor(() => expect(openExternal).toHaveBeenCalledWith('https://wa.me/62811?text=DAFTAR%20ABCD2345'));
    expect(post).toHaveBeenCalledWith('/crm/api/v1/whatsapp/opt-in/code', {}, true);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('falls back to a new tab on the web (openExternal declines)', async () => {
    serve({ '/whatsapp/status': on, '/whatsapp/me': { state: 'NONE', phone: null } });
    post.mockResolvedValue({ id: 'c1', code: 'A', expiresAt: 'x', link: 'https://wa.me/62811?text=DAFTAR%20A' });
    openExternal.mockReturnValue(false);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<WaOptInCard />);
    await userEvent.click(await screen.findByText('wa.card.connect'));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://wa.me/62811?text=DAFTAR%20A', '_blank', 'noopener,noreferrer'));
    open.mockRestore();
  });

  it('shows an error toast when the code cannot be made', async () => {
    serve({ '/whatsapp/status': on, '/whatsapp/me': { state: 'NONE', phone: null } });
    post.mockRejectedValue(new Error('boom'));
    render(<WaOptInCard />);
    await userEvent.click(await screen.findByText('wa.card.connect'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('wa.card.error', 'error'));
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('GRANTED: shows the masked number and disconnects', async () => {
    serve({ '/whatsapp/status': on, '/whatsapp/me': { state: 'GRANTED', phone: '+62 8xx-xxxx-1234' } });
    post.mockResolvedValue({ revoked: true });
    render(<WaOptInCard />);
    expect(await screen.findByText('wa.card.connected|+62 8xx-xxxx-1234')).toBeTruthy();
    await userEvent.click(screen.getByText('wa.card.disconnect'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/crm/api/v1/whatsapp/me/revoke', {}, true));
    expect(toast).toHaveBeenCalledWith('wa.card.disconnectedToast', 'success');
  });

  it('GRANTED: a failed withdrawal says so', async () => {
    serve({ '/whatsapp/status': on, '/whatsapp/me': { state: 'GRANTED', phone: '+62 8xx-xxxx-1234' } });
    post.mockRejectedValue(new Error('boom'));
    render(<WaOptInCard />);
    await userEvent.click(await screen.findByText('wa.card.disconnect'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('wa.card.disconnectError', 'error'));
  });

  it('STOPPED: explains MULAI and still offers a new code', async () => {
    serve({ '/whatsapp/status': on, '/whatsapp/me': { state: 'STOPPED', phone: null } });
    render(<WaOptInCard />);
    expect(await screen.findByText('wa.card.stopped')).toBeTruthy();
    expect(screen.getByText('wa.card.connect')).toBeTruthy();
  });

  it('reloads the state when the customer comes back to the app', async () => {
    serve({ '/whatsapp/status': on, '/whatsapp/me': { state: 'NONE', phone: null } });
    render(<WaOptInCard />);
    await screen.findByText('wa.card.connect');
    const before = get.mock.calls.filter(([p]) => String(p).endsWith('/me')).length;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(get.mock.calls.filter(([p]) => String(p).endsWith('/me')).length).toBe(before + 1));
  });
});

describe('CounterWaOptIn (cashier QR)', () => {
  const code = { id: 'code-1', code: 'ABCD2345', expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), link: 'https://wa.me/62811?text=DAFTAR%20ABCD2345' };

  it('is not offered to a role that cannot issue codes, and never calls the server', async () => {
    auth.role = 'FINANCE';
    const { container } = render(<CounterWaOptIn depotId="d1" />);
    await act(async () => undefined);
    expect(container.textContent).toBe('');
    expect(get).not.toHaveBeenCalled();
  });

  it('is hidden while WhatsApp is off', async () => {
    serve({ '/whatsapp/status': off });
    const { container } = render(<CounterWaOptIn depotId="d1" />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('draws the QR, shows the code, copies the link and sees the customer connect', async () => {
    serve({ '/whatsapp/status': on });
    post.mockResolvedValue(code);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CounterWaOptIn depotId="d1" />);
    await userEvent.click(await screen.findByText('wa.cashier.open'));
    expect(await screen.findByText('wa.cashier.codeLine|ABCD2345')).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('wa.cashier.qrAlt');
    // A walk-in code: the body carries the depot and nothing about a customer.
    expect(post).toHaveBeenCalledWith('/crm/api/v1/whatsapp/opt-in/codes', { depotId: 'd1' }, true);

    await userEvent.click(screen.getByText('wa.cashier.copy'));
    expect(writeText).toHaveBeenCalledWith(code.link);
    expect(toast).toHaveBeenCalledWith('wa.cashier.copied', 'success');

    vi.useFakeTimers({ shouldAdvanceTime: true });
    get.mockImplementation(async (p: string) => (p.endsWith('/code-1') ? { state: 'USED' } : on));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(await screen.findByText('wa.cashier.used')).toBeTruthy();
    // Used: polling stops.
    const calls = get.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(get.mock.calls.length).toBe(calls);
  });

  it('keeps polling through a failed poll, then stops at expiry', async () => {
    serve({ '/whatsapp/status': on });
    post.mockResolvedValue({ ...code, expiresAt: new Date(Date.now() + 5000).toISOString() });
    render(<CounterWaOptIn depotId="d1" />);
    await userEvent.click(await screen.findByText('wa.cashier.open'));
    await screen.findByText('wa.cashier.codeLine|ABCD2345');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    get.mockImplementation(async (p: string) => {
      if (p.endsWith('/code-1')) throw new Error('offline');
      return on;
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(screen.queryByText('wa.cashier.expired')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(await screen.findByText('wa.cashier.expired')).toBeTruthy();
  });

  it('says so when the code cannot be made, and can try again', async () => {
    serve({ '/whatsapp/status': on });
    post.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(code);
    render(<CounterWaOptIn depotId="d1" />);
    await userEvent.click(await screen.findByText('wa.cashier.open'));
    expect(await screen.findByText('wa.cashier.error')).toBeTruthy();
    await userEvent.click(screen.getByText('wa.cashier.renew'));
    expect(await screen.findByText('wa.cashier.codeLine|ABCD2345')).toBeTruthy();
  });

  it('reports a copy that the device refuses', async () => {
    serve({ '/whatsapp/status': on });
    post.mockResolvedValue(code);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('no')) }, configurable: true });
    render(<CounterWaOptIn depotId="d1" />);
    await userEvent.click(await screen.findByText('wa.cashier.open'));
    await screen.findByText('wa.cashier.codeLine|ABCD2345');
    await userEvent.click(screen.getByText('wa.cashier.copy'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('wa.cashier.copyError', 'error'));
  });
});

const overview = (over: Record<string, unknown> = {}) => ({
  state: 'ON',
  missing: [],
  month: '2026-11',
  categories: [
    { category: 'UTILITY', monthlyMessages: 100, rateIdr: 350, monthlyCostIdr: null, paused: false, messages: 85, costIdr: 29750 },
    { category: 'MARKETING', monthlyMessages: null, rateIdr: null, monthlyCostIdr: null, paused: false, messages: 0, costIdr: null },
    { category: 'AUTHENTICATION', monthlyMessages: 10, rateIdr: null, monthlyCostIdr: null, paused: false, messages: 10, costIdr: null },
    { category: 'SERVICE', monthlyMessages: 5, rateIdr: null, monthlyCostIdr: null, paused: false, messages: 1, costIdr: null },
  ],
  templates: [{ id: 't1', name: 'order_confirmed', language: 'id', event: 'ORDER_CONFIRMED', category: 'UTILITY', bodyParams: 3, status: 'DRAFT', statusReason: null }],
  problems: [{ id: 'p1', status: 'SKIPPED', skipReason: 'CAP', templateName: 'order_confirmed', createdAt: '2026-11-28T01:00:00Z' }],
  ...over,
});

describe('/hq/whatsapp', () => {
  it('shows state, usage bars, "rate not filled in", templates and the last refusals', async () => {
    serve({ '/hq/overview': overview() });
    render(<HqWhatsappPage />);
    expect(await screen.findByText('wa.hq.state.ON')).toBeTruthy();
    expect(screen.getByText('85 / 100')).toBeTruthy();
    expect(screen.getAllByText(/wa\.hq\.noRate/).length).toBeGreaterThan(0);
    expect(screen.getByText('wa.hq.noCap', { exact: false })).toBeTruthy();
    expect(screen.getByText('order_confirmed', { selector: 'td' })).toBeTruthy();
    expect(screen.getByText('wa.hq.skip.CAP')).toBeTruthy();
    const bars = screen.getAllByRole('progressbar').map((b) => b.getAttribute('aria-valuenow'));
    expect(bars).toEqual(['85', '0', '100', '20']);
  });

  it('names the missing keys when the setup is incomplete', async () => {
    serve({ '/hq/overview': overview({ state: 'INCOMPLETE', missing: ['WA_ACCESS_TOKEN', 'WA_APP_SECRET'] }) });
    render(<HqWhatsappPage />);
    expect(await screen.findByText('wa.hq.missing|WA_ACCESS_TOKEN, WA_APP_SECRET')).toBeTruthy();
  });

  it('shows an empty list of refusals', async () => {
    serve({ '/hq/overview': overview({ problems: [] }) });
    render(<HqWhatsappPage />);
    expect(await screen.findByText('wa.hq.problemsEmpty')).toBeTruthy();
  });

  it('shows a plain status for a refusal without a skip reason', async () => {
    serve({ '/hq/overview': overview({ problems: [{ id: 'p2', status: 'FAILED', skipReason: null, templateName: 'x', createdAt: 'now' }] }) });
    render(<HqWhatsappPage />);
    expect(await screen.findByText('FAILED')).toBeTruthy();
  });

  it('errors with a retry when the overview cannot be read', async () => {
    serve({ '/hq/overview': new Error('403') });
    render(<HqWhatsappPage />);
    expect(await screen.findByText('wa.hq.loadError')).toBeTruthy();
  });

  it('saves a cap with a rate; an empty rate is sent as null', async () => {
    serve({ '/hq/overview': overview() });
    put.mockResolvedValue(undefined);
    render(<HqWhatsappPage />);
    const cap = (await screen.findAllByLabelText('wa.hq.capLabel'))[0]!;
    fireEvent.change(cap, { target: { value: '200' } });
    fireEvent.change(screen.getAllByLabelText('wa.hq.rateLabel')[0]!, { target: { value: '' } });
    await userEvent.click(screen.getAllByText('wa.hq.save')[0]!);
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        '/crm/api/v1/whatsapp/hq/caps/UTILITY',
        { monthlyMessages: 200, rateIdr: null, monthlyCostIdr: null },
        true,
      ),
    );
    expect(toast).toHaveBeenCalledWith('wa.hq.saved', 'success');
  });

  it('refuses a bad number instead of sending it', async () => {
    serve({ '/hq/overview': overview() });
    render(<HqWhatsappPage />);
    fireEvent.change((await screen.findAllByLabelText('wa.hq.rateLabel'))[0]!, { target: { value: 'abc' } });
    expect((screen.getAllByText('wa.hq.save')[0]!.closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect(put).not.toHaveBeenCalled();
  });

  it('reports a failed save', async () => {
    serve({ '/hq/overview': overview() });
    put.mockRejectedValue(new Error('boom'));
    render(<HqWhatsappPage />);
    await userEvent.click((await screen.findAllByText('wa.hq.save'))[0]!);
    await waitFor(() => expect(toast).toHaveBeenCalledWith('wa.hq.saveError', 'error'));
  });

  it('pauses everything only after the confirmation', async () => {
    serve({ '/hq/overview': overview() });
    post.mockResolvedValue({ rows: 4 });
    confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<HqWhatsappPage />);
    const button = await screen.findByText('wa.hq.pauseAll', { selector: 'button' });
    await userEvent.click(button);
    expect(post).not.toHaveBeenCalled();
    await userEvent.click(button);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/crm/api/v1/whatsapp/hq/pause', { paused: true }, true));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: 'wa.hq.pauseConfirm' }));
    expect(toast).toHaveBeenCalledWith('wa.hq.paused', 'success');
  });

  it('resumes without a question when paused, and reports a failure', async () => {
    serve({ '/hq/overview': overview({ state: 'PAUSED' }) });
    post.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ rows: 4 });
    render(<HqWhatsappPage />);
    const resume = await screen.findByText('wa.hq.resume');
    await userEvent.click(resume);
    await waitFor(() => expect(toast).toHaveBeenCalledWith('wa.hq.pauseError', 'error'));
    await userEvent.click(resume);
    await waitFor(() => expect(post).toHaveBeenLastCalledWith('/crm/api/v1/whatsapp/hq/pause', { paused: false }, true));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('marks a template by hand, and reports a failure', async () => {
    serve({ '/hq/overview': overview() });
    put.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
    render(<HqWhatsappPage />);
    const select = await screen.findByLabelText('wa.hq.tplStatusLabel|order_confirmed');
    await userEvent.selectOptions(select, 'APPROVED');
    await waitFor(() => expect(toast).toHaveBeenCalledWith('wa.hq.saveError', 'error'));
    await userEvent.selectOptions(select, 'APPROVED');
    await waitFor(() =>
      expect(put).toHaveBeenLastCalledWith('/crm/api/v1/whatsapp/hq/templates', { name: 'order_confirmed', language: 'id', status: 'APPROVED' }, true),
    );
  });

  it('is read-only for a role without waManage (waCostRead only)', async () => {
    auth.role = 'FINANCE';
    serve({ '/hq/overview': overview() });
    render(<HqWhatsappPage />);
    await screen.findByText('wa.hq.state.ON');
    expect(screen.queryByText('wa.hq.pauseAll', { selector: 'button' })).toBeNull();
    expect(screen.queryByText('wa.hq.save')).toBeNull();
    expect(screen.queryByLabelText('wa.hq.tplStatusLabel|order_confirmed')).toBeNull();
    expect(screen.getByText('wa.hq.tplStatuses.DRAFT')).toBeTruthy();
    expect((screen.getAllByLabelText('wa.hq.capLabel')[0] as HTMLInputElement).disabled).toBe(true);
  });
});
