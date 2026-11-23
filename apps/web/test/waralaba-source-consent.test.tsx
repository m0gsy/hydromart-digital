// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { post }, ApiError: class ApiError extends Error {} }));

import { LocaleProvider } from '@/lib/locale-context';
import FranchiseApplicationPage from '@/app/waralaba/page';

const RECEIPT = {
  id: 'a1',
  proposedCode: 'BDG-02',
  proposedName: 'Depot Buah Batu',
  submittedAt: '2026-11-23T03:00:00.000Z',
};

function fillAndSend() {
  const set = (id: string, value: string) =>
    fireEvent.change(document.getElementById(id)!, { target: { value } });
  set('fa-name', 'Budi Santoso');
  set('fa-phone', '081234567890');
  set('fa-code', 'bdg-02');
  set('fa-depot-name', 'Depot Buah Batu');
  set('fa-city', 'Bandung');
  set('fa-province', 'Jawa Barat');
  set('fa-lat', '-6.9421');
  set('fa-lng', '107.6386');
  set('fa-investment', '150000000');
  set('fa-revenue', '45000000');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: /kirim pengajuan|submit application/i }));
}

// A block body on purpose: vitest calls a function returned from beforeEach as a teardown, and
// mockResolvedValue returns the mock, so an arrow body would "post" once after every test.
beforeEach(() => {
  post.mockResolvedValue(RECEIPT);
});
afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});

/**
 * HD-8. The application carries where the calon mitra came from (the first coded link this
 * browser followed, and the latest), beside the consent the server now records.
 */
describe('/waralaba: the source of an application', () => {
  it('sends the first code this browser kept and the latest', async () => {
    localStorage.setItem('hydromart.source', JSON.stringify({ first: 'pameran-jkt', last: 'meta-iklan-bdg' }));
    render(<FranchiseApplicationPage />, { wrapper: LocaleProvider });
    fillAndSend();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      privacyConsent: true,
      firstSource: 'pameran-jkt',
      lastSource: 'meta-iklan-bdg',
    });
  });

  it('sends no source at all when no coded link was followed', async () => {
    render(<FranchiseApplicationPage />, { wrapper: LocaleProvider });
    fillAndSend();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty('firstSource');
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty('lastSource');
  });
});
