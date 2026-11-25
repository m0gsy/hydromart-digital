// @vitest-environment jsdom
//
// HD-16 PR-1 — the HQ SOP screens: the list, one SOP's version history with who has not read each
// version, and the form that publishes a SOP or its next version. The server decides everything
// that matters (audience, day, key); these tests hold the screen to showing it and to sending what
// the person typed.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, upload, blob, save, toast, role, query, depots, FakeApiError } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  upload: vi.fn(),
  blob: vi.fn(),
  save: vi.fn(),
  toast: vi.fn(),
  role: { current: 'HEAD_OFFICE' },
  query: { id: '00000000-0000-4000-8000-0000000000a1' },
  depots: vi.fn(),
  FakeApiError: class extends Error {
    constructor(
      public readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post },
  uploadFile: upload,
  getBlob: blob,
  ApiError: FakeApiError,
}));
vi.mock('@/lib/csv', () => ({ downloadBlob: save }));
vi.mock('@/lib/all-depots', () => ({ fetchAllDepots: depots }));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, vars?: Record<string, unknown>) => (vars ? `${k}|${JSON.stringify(vars)}` : k),
    locale: 'id',
  }),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { id: 'u1', role: role.current }, ready: true }) }));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => query.id }));
vi.mock('@/lib/wib', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wib')>()),
  todayWib: () => '2026-11-28',
}));

import HqSopDetailPage from '@/app/hq/sop/detail/page';
import HqSopPage from '@/app/hq/sop/page';

const D1 = '00000000-0000-4000-8000-000000000001';
const D2 = '00000000-0000-4000-8000-000000000002';

const version = (over: Record<string, unknown> = {}) => ({
  id: 'ver-1',
  versionNo: 1,
  title: 'SOP isi ulang galon',
  effectiveFrom: '2026-11-01',
  allDepots: true,
  depotIds: [],
  hasFile: false,
  fileName: null,
  sizeBytes: null,
  audienceSize: 10,
  ackCount: 7,
  unread: 3,
  createdAt: '2026-11-01T00:00:00.000Z',
  ...over,
});

const summary = (over: Record<string, unknown> = {}) => ({
  id: 'sop-1',
  title: 'SOP isi ulang galon',
  createdAt: '2026-11-01T00:00:00.000Z',
  versionCount: 2,
  current: version(),
  upcoming: null,
  ...over,
});

const detail = (versions: unknown[]) => ({ id: 'sop-1', title: 'SOP isi ulang galon', createdAt: '2026-11-01T00:00:00.000Z', versions });

const unreadPage = (over: Record<string, unknown> = {}) => ({
  versionId: 'ver-1',
  versionNo: 1,
  audienceSize: 10,
  ackCount: 7,
  unreadTotal: 3,
  byDepot: [
    { depotId: D1, unread: 2 },
    { depotId: '00000000-0000-4000-8000-0000000000ff', unread: 1 },
    { depotId: null, unread: 1 },
  ],
  page: 1,
  pageSize: 50,
  items: [
    { employeeId: 'e1', employeeCode: 'HR-1', fullName: 'Budi', position: 'Staff', depotId: D1 },
    { employeeId: 'e2', employeeCode: 'HR-2', fullName: 'Sari', position: 'Kasir', depotId: D1 },
  ],
  ...over,
});

beforeEach(() => {
  role.current = 'HEAD_OFFICE';
  get.mockReset().mockResolvedValue([]);
  post.mockReset().mockResolvedValue(detail([]));
  upload.mockReset();
  blob.mockReset().mockResolvedValue(new Blob(['%PDF']));
  save.mockReset();
  toast.mockReset();
  depots.mockReset().mockResolvedValue([
    { id: D1, code: 'JKT-01', name: 'Jakarta' },
    { id: D2, code: 'BDG-01', name: 'Bandung' },
  ]);
});
afterEach(() => vi.clearAllMocks());

describe('the SOP list', () => {
  it('shows each SOP with the version in force, its audience and how many have read it', async () => {
    get.mockResolvedValue([
      summary(),
      summary({ id: 'sop-2', title: 'SOP kebersihan', current: version({ id: 'ver-9', allDepots: false, depotIds: [D1, D2], ackCount: 5, audienceSize: 5, unread: 0 }), upcoming: version({ versionNo: 2, effectiveFrom: '2026-12-01' }) }),
      summary({ id: 'sop-3', title: 'SOP baru', current: null, versionCount: 1 }),
    ]);
    render(<HqSopPage />);
    expect(await screen.findByText('SOP isi ulang galon')).toBeTruthy();
    expect(screen.getByText('hq.sop.readOf|{"read":7,"total":10}')).toBeTruthy();
    expect(screen.getByText('hq.sop.unread|{"n":3}')).toBeTruthy();
    expect(screen.getByText('hq.sop.allRead')).toBeTruthy();
    expect(screen.getByText(/hq\.sop\.depotCount\|\{"n":2\}/)).toBeTruthy();
    expect(screen.getByText('hq.sop.noneInForce')).toBeTruthy();
    expect(screen.getByText(/hq\.sop\.upcoming/)).toBeTruthy();
    const links = screen.getAllByText('hq.sop.detail').map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/hq/sop/detail?id=sop-1', '/hq/sop/detail?id=sop-2', '/hq/sop/detail?id=sop-3']);
    expect(get).toHaveBeenCalledWith('/sops/api/v1/sops', true);
  });

  it('says there is nothing yet, and says so when the read failed', async () => {
    const view = render(<HqSopPage />);
    expect(await screen.findByText('hq.sop.empty')).toBeTruthy();
    view.unmount();
    get.mockRejectedValue(new FakeApiError(500, 'hr down'));
    render(<HqSopPage />);
    expect(await screen.findByText('hq.sop.loadError')).toBeTruthy();
  });

  it('offers "SOP baru" only to someone who may write', async () => {
    role.current = 'HR';
    const view = render(<HqSopPage />);
    await screen.findByText('hq.sop.empty');
    expect(screen.queryByText('hq.sop.add')).toBeNull();
    view.unmount();
    role.current = 'HEAD_OFFICE';
    render(<HqSopPage />);
    expect(await screen.findByText('hq.sop.add')).toBeTruthy();
  });

  it('publishes a new SOP for every depot with the text typed, then reloads the list', async () => {
    const user = userEvent.setup();
    render(<HqSopPage />);
    await user.click(await screen.findByText('hq.sop.add'));
    const submit = screen.getByText('hq.sop.form.submit').closest('button') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.type(screen.getByLabelText('hq.sop.form.title'), 'SOP baru');
    await user.type(screen.getByLabelText('hq.sop.form.body'), 'Langkah satu');
    await user.type(screen.getByLabelText('hq.sop.form.versionName'), 'Judul versi');
    expect(submit.disabled).toBe(false);
    get.mockClear();
    await user.click(submit);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith(
      '/sops/api/v1/sops',
      {
        title: 'SOP baru',
        versionTitle: 'Judul versi',
        body: 'Langkah satu',
        fileKey: undefined,
        fileName: undefined,
        sizeBytes: undefined,
        effectiveFrom: '2026-11-28',
        allDepots: true,
        depotIds: undefined,
      },
      true,
    );
    expect(toast).toHaveBeenCalledWith('hq.sop.form.saved', 'success');
    await waitFor(() => expect(get).toHaveBeenCalledWith('/sops/api/v1/sops', true));
    expect(screen.queryByText('hq.sop.form.submit')).toBeNull();
  });

  it('refuses a backdated day and a depot list left empty before it sends anything', async () => {
    const user = userEvent.setup();
    render(<HqSopPage />);
    await user.click(await screen.findByText('hq.sop.add'));
    await user.type(screen.getByLabelText('hq.sop.form.title'), 'SOP baru');
    await user.type(screen.getByLabelText('hq.sop.form.body'), 'x');
    const submit = screen.getByText('hq.sop.form.submit').closest('button') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('hq.sop.form.effectiveFrom'), { target: { value: '2026-11-27' } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('hq.sop.form.effectiveFrom'), { target: { value: '2026-12-01' } });
    expect(submit.disabled).toBe(false);
    await user.click(screen.getByText('hq.sop.form.scopeSome'));
    expect(submit.disabled).toBe(true);
    expect(await screen.findByText('JKT-01 · Jakarta')).toBeTruthy();
    await user.click(screen.getByLabelText('JKT-01 · Jakarta'));
    await user.click(screen.getByLabelText('BDG-01 · Bandung'));
    await user.click(screen.getByLabelText('BDG-01 · Bandung'));
    expect(submit.disabled).toBe(false);
    await user.click(submit);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![1]).toMatchObject({ effectiveFrom: '2026-12-01', allDepots: false, depotIds: [D1] });
  });

  it('keeps the form open with the server answer when saving fails, and a plain message otherwise', async () => {
    const user = userEvent.setup();
    render(<HqSopPage />);
    await user.click(await screen.findByText('hq.sop.add'));
    await user.type(screen.getByLabelText('hq.sop.form.title'), 'SOP baru');
    await user.type(screen.getByLabelText('hq.sop.form.body'), 'x');
    post.mockRejectedValueOnce(new FakeApiError(400, 'Tanggal berlaku tidak boleh sebelum hari ini'));
    await user.click(screen.getByText('hq.sop.form.submit'));
    expect(await screen.findByText('Tanggal berlaku tidak boleh sebelum hari ini')).toBeTruthy();
    post.mockRejectedValueOnce(new Error('network'));
    await user.click(screen.getByText('hq.sop.form.submit'));
    expect(await screen.findByText('hq.sop.form.saveError')).toBeTruthy();
    await user.click(screen.getByText('hq.sop.form.cancel'));
    expect(screen.queryByText('hq.sop.form.submit')).toBeNull();
  });

  it('uploads a PDF and sends its key; a failed upload says why and keeps no file', async () => {
    const user = userEvent.setup();
    render(<HqSopPage />);
    await user.click(await screen.findByText('hq.sop.add'));
    await user.type(screen.getByLabelText('hq.sop.form.title'), 'SOP pdf');
    const input = screen.getByLabelText('hq.sop.form.pdf') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [] } });
    expect(upload).not.toHaveBeenCalled();

    upload.mockRejectedValueOnce(new FakeApiError(400, 'File SOP harus berupa PDF'));
    await user.upload(input, new File(['x'], 'bad.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText('File SOP harus berupa PDF')).toBeTruthy();
    upload.mockRejectedValueOnce(new Error('offline'));
    await user.upload(input, new File(['x'], 'bad.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText('hq.sop.form.pdfError')).toBeTruthy();
    expect((screen.getByText('hq.sop.form.submit').closest('button') as HTMLButtonElement).disabled).toBe(true);

    upload.mockResolvedValueOnce({ fileKey: 'hr/sop/00000000-0000-4000-8000-0000000000f1.pdf', fileName: 'sop.pdf', sizeBytes: 12 });
    await user.upload(input, new File(['%PDF-1.4'], 'sop.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText('hq.sop.form.pdfChosen|{"name":"sop.pdf"}')).toBeTruthy();
    await user.click(screen.getByText('hq.sop.form.submit'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![1]).toMatchObject({
      fileKey: 'hr/sop/00000000-0000-4000-8000-0000000000f1.pdf',
      fileName: 'sop.pdf',
      sizeBytes: 12,
      body: undefined,
    });
  });

  it('refuses an oversized or non-PDF file without uploading it, and drops a chosen file on request', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<HqSopPage />);
    await user.click(await screen.findByText('hq.sop.add'));
    await user.type(screen.getByLabelText('hq.sop.form.title'), 'SOP pdf');
    const submit = screen.getByText('hq.sop.form.submit').closest('button') as HTMLButtonElement;
    // Neither text nor a file: nothing to publish.
    expect(submit.disabled).toBe(true);
    const input = screen.getByLabelText('hq.sop.form.pdf') as HTMLInputElement;

    const big = new File(['x'], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });
    await user.upload(input, big);
    expect(await screen.findByText('hq.sop.form.pdfInvalid')).toBeTruthy();
    await user.upload(input, new File(['x'], 'a.png', { type: 'image/png' }));
    expect(await screen.findByText('hq.sop.form.pdfInvalid')).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
    expect(submit.disabled).toBe(true);

    upload.mockResolvedValueOnce({ fileKey: 'hr/sop/00000000-0000-4000-8000-0000000000f1.pdf', fileName: 'sop.pdf', sizeBytes: 12 });
    await user.upload(input, new File(['%PDF-1.4'], 'sop.pdf', { type: 'application/pdf' }));
    await screen.findByText(/hq.sop.form.pdfChosen/);
    expect(submit.disabled).toBe(false);
    await user.click(screen.getByText('hq.sop.form.pdfRemove'));
    expect(screen.queryByText(/hq.sop.form.pdfChosen/)).toBeNull();
    expect(submit.disabled).toBe(true);
    // A text-only version can be saved once the file is gone.
    await user.type(screen.getByLabelText('hq.sop.form.body'), 'Hanya teks');
    await user.click(submit);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![1]).toMatchObject({ body: 'Hanya teks', fileKey: undefined });
  });

  it('names the failure when the depot list cannot be loaded', async () => {
    depots.mockRejectedValue(new Error('depot down'));
    const user = userEvent.setup();
    render(<HqSopPage />);
    await user.click(await screen.findByText('hq.sop.add'));
    await user.click(screen.getByText('hq.sop.form.scopeSome'));
    expect(await screen.findByText('hq.sop.form.depotsError')).toBeTruthy();
  });
});

describe('one SOP', () => {
  const twoVersions = () =>
    detail([
      { ...version({ id: 'ver-2', versionNo: 2, hasFile: true, fileName: 'sop-v2.pdf', allDepots: false, depotIds: [D1], unread: 0, ackCount: 10 }), body: 'Isi versi dua' },
      { ...version(), body: null },
    ]);

  it('lists the versions newest first with their read counts, file and text', async () => {
    get.mockResolvedValue(twoVersions());
    render(<HqSopDetailPage />);
    expect(await screen.findByText('SOP isi ulang galon', { selector: 'h1' })).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/sops/api/v1/sops/00000000-0000-4000-8000-0000000000a1', true);
    expect(screen.getByText('Isi versi dua')).toBeTruthy();
    expect(screen.getByText(/sop-v2\.pdf/)).toBeTruthy();
    expect(screen.getAllByText(/hq\.sop\.allRead/).length).toBe(1);
    expect(screen.getByText(/hq\.sop\.unread\|\{"n":3\}/)).toBeTruthy();
    expect(screen.getByText('hq.sop.back').getAttribute('href')).toBe('/hq/sop');
  });

  it('opens a version PDF through the session, and reports a failure', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(twoVersions());
    render(<HqSopDetailPage />);
    await user.click(await screen.findByText('hq.sop.openPdf'));
    await waitFor(() => expect(save).toHaveBeenCalledWith('sop-v2.pdf', expect.any(Blob)));
    expect(blob).toHaveBeenCalledWith('/sops/api/v1/sops/versions/ver-2/file');
    blob.mockRejectedValueOnce(new FakeApiError(404, 'File SOP tidak ditemukan'));
    await user.click(screen.getByText('hq.sop.openPdf'));
    expect(await screen.findByText('File SOP tidak ditemukan')).toBeTruthy();
    blob.mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByText('hq.sop.openPdf'));
    expect(await screen.findByText('hq.sop.pdfFailed')).toBeTruthy();
  });

  it('says it is gone when the SOP cannot be read', async () => {
    get.mockRejectedValue(new FakeApiError(404, 'SOP tidak ditemukan'));
    render(<HqSopDetailPage />);
    expect(await screen.findByText('hq.sop.notFound')).toBeTruthy();
  });

  it('adds a version for someone who may write, and hides the button from someone who may not', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(twoVersions());
    const view = render(<HqSopDetailPage />);
    await user.click(await screen.findByText('hq.sop.addVersion'));
    await user.type(screen.getByLabelText('hq.sop.form.body'), 'Revisi');
    get.mockClear();
    await user.click(screen.getByText('hq.sop.form.submit'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![0]).toBe('/sops/api/v1/sops/sop-1/versions');
    expect(post.mock.calls[0]![1]).not.toHaveProperty('title');
    await waitFor(() => expect(get).toHaveBeenCalled());
    view.unmount();

    role.current = 'HR';
    render(<HqSopDetailPage />);
    await screen.findByText('SOP isi ulang galon', { selector: 'h1' });
    expect(screen.queryByText('hq.sop.addVersion')).toBeNull();
  });

  it('shows who has not read a version, with per-depot counts and more pages', async () => {
    const user = userEvent.setup();
    get.mockImplementation((path: string) => {
      if (path.includes('/unread')) {
        return Promise.resolve(path.includes('page=2') ? unreadPage({ page: 2, items: [{ employeeId: 'e3', employeeCode: 'HR-3', fullName: 'Joko', position: 'Staff', depotId: null }] }) : unreadPage({ unreadTotal: 3 }));
      }
      return Promise.resolve(twoVersions());
    });
    render(<HqSopDetailPage />);
    const buttons = await screen.findAllByText('hq.sop.showUnread');
    await user.click(buttons[1]!);
    expect(await screen.findByText('Budi')).toBeTruthy();
    expect(screen.getByText('Sari')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/sops/api/v1/sops/versions/ver-1/unread?page=1&pageSize=50', true);
    expect(screen.getByText('JKT-01 · Jakarta · 2')).toBeTruthy();
    expect(screen.getByText('00000000 · 1')).toBeTruthy();
    expect(screen.getByText('hq.sop.noDepot · 1')).toBeTruthy();

    await user.click(screen.getByText('hq.sop.more'));
    expect(await screen.findByText('Joko')).toBeTruthy();
    expect(screen.queryByText('hq.sop.more')).toBeNull();
    await user.click(screen.getByText('hq.sop.hideUnread'));
    expect(screen.queryByText('Budi')).toBeNull();
  });

  it('keeps the names it has when the next page fails', async () => {
    const user = userEvent.setup();
    get.mockImplementation((path: string) => {
      if (path.includes('page=2')) return Promise.reject(new Error('offline'));
      if (path.includes('/unread')) return Promise.resolve(unreadPage({ unreadTotal: 120 }));
      return Promise.resolve(twoVersions());
    });
    render(<HqSopDetailPage />);
    await user.click((await screen.findAllByText('hq.sop.showUnread'))[1]!);
    await screen.findByText('Budi');
    await user.click(screen.getByText('hq.sop.more'));
    expect(await screen.findByText('hq.sop.unreadError')).toBeTruthy();
    expect(screen.getByText('Budi')).toBeTruthy();
  });

  it('says so when everyone has read it, and when the list cannot be loaded', async () => {
    const user = userEvent.setup();
    get.mockImplementation((path: string) =>
      path.includes('/unread') ? Promise.resolve(unreadPage({ unreadTotal: 0, items: [], byDepot: [] })) : Promise.resolve(twoVersions()),
    );
    const view = render(<HqSopDetailPage />);
    await user.click((await screen.findAllByText('hq.sop.showUnread'))[0]!);
    expect(await screen.findByText('hq.sop.unreadEmpty')).toBeTruthy();
    view.unmount();

    depots.mockRejectedValue(new Error('no directory'));
    get.mockImplementation((path: string) =>
      path.includes('/unread') ? Promise.reject(new FakeApiError(500, 'x')) : Promise.resolve(twoVersions()),
    );
    render(<HqSopDetailPage />);
    await user.click((await screen.findAllByText('hq.sop.showUnread'))[0]!);
    const failed = await screen.findByText('hq.sop.unreadError');
    expect(within(failed.closest('div') as HTMLElement)).toBeTruthy();
  });
});
