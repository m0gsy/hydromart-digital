// @vitest-environment jsdom
// HD-22: /waralaba hands over to the AI web form when the server says so.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ get: vi.fn(), native: false, replace: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { post: vi.fn(), get: h.get }, ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/platform', () => ({ isNativeShell: () => h.native, openExternal: () => false }));

import FranchiseApplicationPage from '@/app/waralaba/page';
import { franchise } from '@/lib/dictionaries/id/franchise';
import { LocaleProvider } from '@/lib/locale-context';

const URL = 'https://ai.example.test/daftar-mitra';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.native = false;
});

function stubReplace() {
  const real = window.location;
  Object.defineProperty(window, 'location', { configurable: true, value: { ...real, replace: h.replace } });
  return () => Object.defineProperty(window, 'location', { configurable: true, value: real });
}

describe('/waralaba cutover', () => {
  it('shows the notice and a button to the form, and redirects on the web', async () => {
    const restore = stubReplace();
    h.get.mockResolvedValue({ url: URL });
    render(<FranchiseApplicationPage />, { wrapper: LocaleProvider });
    expect(await screen.findByText(franchise.movedNotice)).toBeTruthy();
    expect(screen.getByRole('link', { name: franchise.openForm }).getAttribute('href')).toBe(URL);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(h.replace).toHaveBeenCalledWith(URL);
    restore();
  });

  it('does not redirect inside the app, the button is enough', async () => {
    const restore = stubReplace();
    h.native = true;
    h.get.mockResolvedValue({ url: URL });
    render(<FranchiseApplicationPage />, { wrapper: LocaleProvider });
    expect(await screen.findByText(franchise.movedNotice)).toBeTruthy();
    expect(h.replace).not.toHaveBeenCalled();
    restore();
  });

  it('keeps the in-app form when no URL is set', async () => {
    h.get.mockResolvedValue({ url: null });
    render(<FranchiseApplicationPage />, { wrapper: LocaleProvider });
    expect(await screen.findByRole('checkbox')).toBeTruthy();
    expect(screen.queryByText(franchise.movedNotice)).toBeNull();
  });

  it('keeps the in-app form when the lookup fails', async () => {
    h.get.mockRejectedValue(new Error('offline'));
    render(<FranchiseApplicationPage />, { wrapper: LocaleProvider });
    expect(await screen.findByRole('checkbox')).toBeTruthy();
  });
});
