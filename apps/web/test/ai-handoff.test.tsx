// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { post, auth, query, FakeApiError, native } = vi.hoisted(() => ({
  native: { value: false },
  post: vi.fn(),
  auth: { customer: { id: 'u-1', role: 'HEAD_OFFICE' } as { id: string; role: string } | null, ready: true },
  query: { value: '' },
  FakeApiError: class FakeApiError extends Error {},
}));

vi.mock('@/lib/api', () => ({ api: { post }, ApiError: FakeApiError }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: auth.customer, ready: auth.ready }) }));
vi.mock('@/lib/platform', () => ({ isNativeShell: () => native.value, openExternal: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/ai/masuk',
  useSearchParams: () => new URLSearchParams(query.value),
}));

import { LocaleProvider } from '@/lib/locale-context';
import AiHandoffPage from '@/app/ai/masuk/page';

const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const STATE = 'af0ifjsldkj-state-0001';
const RETURN = 'https://ai.example.test/masuk/callback';
const link = (over: Record<string, string> = {}) =>
  new URLSearchParams({ challenge: CHALLENGE, state: STATE, return: RETURN, ...over }).toString();

const replace = vi.fn();
const referrer = (value: string) => Object.defineProperty(document, 'referrer', { configurable: true, get: () => value });
beforeEach(() => {
  auth.customer = { id: 'u-1', role: 'HEAD_OFFICE' };
  query.value = link();
  native.value = false;
  referrer('https://ai.example.test/masuk');
  vi.stubGlobal('location', { ...window.location, replace });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const open = () => render(<AiHandoffPage />, { wrapper: LocaleProvider });

describe('/ai/masuk: the AI web sign-in handoff (AI-3b)', () => {
  it("asks for a code once and sends the browser to the server's address with code and state", async () => {
    post.mockResolvedValue({ code: 'one-time-code', expiresIn: 60, returnTo: RETURN });
    const view = open();
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith(
      '/auth/api/v1/auth/handoff/code',
      { codeChallenge: CHALLENGE, codeChallengeMethod: 'S256', returnTo: RETURN },
      true,
    );
    const went = new URL(replace.mock.calls[0]?.[0] as string);
    expect(`${went.origin}${went.pathname}`).toBe(RETURN);
    expect(went.searchParams.get('code')).toBe('one-time-code');
    expect(went.searchParams.get('state')).toBe(STATE);
    // A re-render does not spend a second code.
    view.rerender(<AiHandoffPage />);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('shows the refusal and goes nowhere when the server will not send the code there', async () => {
    post.mockRejectedValue(new FakeApiError('This sign-in link does not lead back to the HYDROMART AI web.'));
    open();
    expect(await screen.findByText(/does not lead back/)).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
    post.mockResolvedValue({ code: 'c2', expiresIn: 60, returnTo: RETURN });
    fireEvent.click(screen.getByRole('button', { name: /coba lagi/i }));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
  });

  it.each([
    ['no challenge', link({ challenge: '' })],
    ['a challenge of the wrong shape', link({ challenge: 'short' })],
    ['a state of the wrong shape', link({ state: 'a b' })],
    ['no return address', link({ return: '' })],
  ])('asks nothing of the server for a link with %s', async (_name, value) => {
    query.value = value;
    open();
    expect(await screen.findByText(/tidak lengkap/)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  // Review M: a link on another site starts nothing by itself.
  it('asks first when opened from anywhere but the AI web, then goes on', async () => {
    post.mockResolvedValue({ code: 'c3', expiresIn: 60, returnTo: RETURN });
    referrer('https://evil.example/page');
    open();
    expect(await screen.findByText(/Lanjutkan hanya kalau kamu sendiri/)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /lanjutkan/i }));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
  });

  it('asks first with no referrer at all', async () => {
    referrer('');
    open();
    expect(await screen.findByRole('button', { name: /lanjutkan/i })).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('asks nothing for a customer account', async () => {
    auth.customer = { id: 'c-1', role: 'CUSTOMER' };
    open();
    expect(await screen.findByText(/hanya untuk akun staf/)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });
});
