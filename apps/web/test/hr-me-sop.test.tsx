// @vitest-environment jsdom
//
// HD-16 PR-2 — the SOPs an employee has to read, and "sudah dibaca". The server decides which
// version binds whom; the screens show it, send the receipt, and never fake one.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, blob, save, query, FakeApiError } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  blob: vi.fn(),
  save: vi.fn(),
  query: { id: 'ver-1' },
  FakeApiError: class extends Error {
    constructor(
      public readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

vi.mock('@/lib/api', () => ({ api: { get, getCached: get, post }, getBlob: blob, ApiError: FakeApiError }));
vi.mock('@/lib/csv', () => ({ downloadBlob: save }));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string, vars?: Record<string, unknown>) => (vars ? `${k}|${JSON.stringify(vars)}` : k), locale: 'id' }),
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => query.id }));

import MySopDetailPage from '@/app/hr/me/sop/detail/page';
import MySopPage from '@/app/hr/me/sop/page';

const mine = (over: Record<string, unknown> = {}) => ({
  sopId: 'sop-1',
  sopTitle: 'SOP isi ulang galon',
  versionId: 'ver-1',
  versionNo: 2,
  title: 'SOP isi ulang galon',
  effectiveFrom: '2026-11-28',
  hasFile: false,
  fileName: null,
  acked: false,
  ackedAt: null,
  ...over,
});

beforeEach(() => {
  get.mockReset().mockResolvedValue([]);
  post.mockReset().mockResolvedValue({ ackedAt: '2026-11-28T01:00:00.000Z' });
  blob.mockReset().mockResolvedValue(new Blob(['%PDF']));
  save.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('my SOP list', () => {
  it('shows what binds me with read state and how many are still unread', async () => {
    get.mockResolvedValue([mine(), mine({ versionId: 'ver-2', sopTitle: 'SOP kebersihan', acked: true, hasFile: true })]);
    render(<MySopPage />);
    expect(await screen.findByText('SOP isi ulang galon')).toBeTruthy();
    expect(screen.getByText('hrFix.mySop.unreadCount|{"n":1}')).toBeTruthy();
    expect(screen.getByText('hrFix.mySop.read')).toBeTruthy();
    expect(screen.getByText(/hrFix\.mySop\.hasFile/)).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/sops/api/v1/sops/me', true);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/hr/me/sop/detail?id=ver-1', '/hr/me/sop/detail?id=ver-2']);
  });

  it('says everything is read when it is', async () => {
    get.mockResolvedValue([mine({ acked: true })]);
    render(<MySopPage />);
    expect(await screen.findByText('hrFix.mySop.allRead')).toBeTruthy();
  });

  it('treats an account with no employee record as having no SOPs, and a real failure as one', async () => {
    get.mockRejectedValue(new FakeApiError(404, 'Akun ini belum tertaut'));
    const view = render(<MySopPage />);
    expect(await screen.findByText('hrFix.mySop.empty')).toBeTruthy();
    view.unmount();
    get.mockRejectedValue(new FakeApiError(500, 'down'));
    render(<MySopPage />);
    expect(await screen.findByText('hrFix.mySop.loadError')).toBeTruthy();
  });
});

describe('reading one SOP', () => {
  const detail = (over: Record<string, unknown> = {}) => ({ ...mine(over), body: 'Cuci tangan dulu.' });

  it('shows the text and sends the receipt, then reloads', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(detail());
    render(<MySopDetailPage />);
    expect(await screen.findByText('Cuci tangan dulu.')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/sops/api/v1/sops/versions/ver-1', true);
    get.mockResolvedValue(detail({ acked: true, ackedAt: '2026-11-28T01:00:00.000Z' }));
    await user.click(screen.getByText('hrFix.mySop.ack'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/sops/api/v1/sops/versions/ver-1/ack', {}, true));
    expect(await screen.findByText(/hrFix\.mySop\.ackedAt/)).toBeTruthy();
    expect(screen.queryByText('hrFix.mySop.ack')).toBeNull();
  });

  it('keeps the button and says why when the receipt does not go through', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(detail());
    render(<MySopDetailPage />);
    await user.click(await screen.findByText('hrFix.mySop.ack'));
    post.mockRejectedValueOnce(new FakeApiError(404, 'SOP tidak ditemukan'));
    await user.click(screen.getByText('hrFix.mySop.ack'));
    expect(await screen.findByText('SOP tidak ditemukan')).toBeTruthy();
    post.mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByText('hrFix.mySop.ack'));
    expect(await screen.findByText('hrFix.mySop.ackFailed')).toBeTruthy();
  });

  it('opens the PDF through the session, and reports a failure', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(detail({ hasFile: true, fileName: 'sop.pdf', body: null }));
    render(<MySopDetailPage />);
    await user.click(await screen.findByText('hrFix.mySop.openPdf'));
    await waitFor(() => expect(save).toHaveBeenCalledWith('sop.pdf', expect.any(Blob)));
    expect(blob).toHaveBeenCalledWith('/sops/api/v1/sops/versions/ver-1/file');
    blob.mockRejectedValueOnce(new FakeApiError(404, 'File SOP tidak ditemukan'));
    await user.click(screen.getByText('hrFix.mySop.openPdf'));
    expect(await screen.findByText('File SOP tidak ditemukan')).toBeTruthy();
    blob.mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByText('hrFix.mySop.openPdf'));
    expect(await screen.findByText('hrFix.mySop.pdfFailed')).toBeTruthy();
  });

  it('names a version that is gone or not mine, and a file with no name still saves', async () => {
    get.mockRejectedValue(new FakeApiError(404, 'SOP tidak ditemukan'));
    const view = render(<MySopDetailPage />);
    expect(await screen.findByText('hrFix.mySop.notFound')).toBeTruthy();
    view.unmount();
    // Any other failure is a failed read, not "not yours".
    get.mockRejectedValue(new FakeApiError(500, 'hr down'));
    const failed = render(<MySopDetailPage />);
    expect(await screen.findByText('hrFix.mySop.loadError')).toBeTruthy();
    expect(screen.queryByText('hrFix.mySop.notFound')).toBeNull();
    failed.unmount();
    const user = userEvent.setup();
    get.mockResolvedValue(detail({ hasFile: true, fileName: null }));
    render(<MySopDetailPage />);
    await user.click(await screen.findByText('hrFix.mySop.openPdf'));
    await waitFor(() => expect(save).toHaveBeenCalledWith('sop.pdf', expect.any(Blob)));
  });
});
