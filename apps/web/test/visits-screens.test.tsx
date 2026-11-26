// @vitest-environment jsdom
//
// HD-15B PR-5 - the Ops visit screens: start (GPS), answer the checklist, complete, and the
// per-depot view with follow-up closing. The server owns every rule (radius, "Perkiraan", caps);
// these tests hold the screens to showing its refusal verbatim, sending what was typed, and to
// offering each action only to the capability that may use it.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, patch, upload, push, position, auth, query, FakeApiError } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  upload: vi.fn(),
  push: vi.fn(),
  position: vi.fn(),
  auth: { role: 'SUPERVISOR' },
  query: { id: 'v-1' },
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

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch },
  uploadFile: upload,
  ApiError: FakeApiError,
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, vars?: Record<string, unknown>) => (vars ? `${k}|${JSON.stringify(vars)}` : k),
    locale: 'id',
  }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: auth.role }, ready: true }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/hr/precise-location-notice', () => ({ PreciseLocationNotice: () => null }));
vi.mock('@/lib/image', () => ({ compressImage: async (f: File) => f }));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => query.id }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/dashboard/visits',
}));
vi.mock('@/lib/geo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/geo')>('@/lib/geo');
  return { ...actual, currentPosition: position };
});

import VisitsPage from '@/app/dashboard/visits/page';
import NewVisitPage from '@/app/dashboard/visits/new/page';
import VisitDetailPage from '@/app/dashboard/visits/detail/page';
import { GeoError } from '@/lib/geo';

const OVERVIEW = '/visits/api/v1/visits/overview';
const DEPOT = '00000000-0000-4000-8000-0000000000d1';

const depot = (over: Record<string, unknown> = {}) => ({
  depotId: DEPOT,
  depotName: 'Depot Bekasi',
  lastVisitAt: '2026-11-20T03:00:00.000Z',
  visitsLast30d: 3,
  unfencedVisitsLast30d: 0,
  openFindings: 2,
  overdueFollowUps: 1,
  ...over,
});
const item = (over: Record<string, unknown> = {}) => ({
  id: 'it-1',
  visitId: 'v-1',
  depotId: DEPOT,
  position: 1,
  text: 'Lantai bersih',
  sopVersionId: null,
  sopVersionNo: null,
  sopTitle: null,
  result: 'PENDING',
  findingNote: null,
  photoUrl: null,
  followUpDueOn: null,
  followUpStatus: null,
  followUpDoneAt: null,
  followUpNote: null,
  ...over,
});
const visit = (over: Record<string, unknown> = {}) => ({
  id: 'v-1',
  depotId: DEPOT,
  templateName: 'Kunjungan rutin',
  visitorId: 'u-1',
  status: 'IN_PROGRESS',
  checkInAt: '2026-11-27T03:00:00.000Z',
  completedAt: null,
  fenceChecked: true,
  approximateFix: false,
  items: [
    item(),
    item({
      id: 'it-2',
      position: 2,
      text: 'Filter diganti',
      sopVersionId: 'sv-1',
      sopVersionNo: 2,
      sopTitle: 'SOP filter',
    }),
  ],
  ...over,
});
const finding = (over: Record<string, unknown> = {}) =>
  item({
    result: 'FINDING',
    findingNote: 'Bocor',
    followUpDueOn: '2026-12-01',
    followUpStatus: 'OPEN',
    photoUrl: 'https://img/x.jpg',
    ...over,
  });

function serve(routes: Record<string, unknown>) {
  get.mockImplementation(async (path: string) => {
    for (const [prefix, value] of Object.entries(routes)) if (path.startsWith(prefix)) return value;
    return [];
  });
}

beforeEach(() => {
  auth.role = 'SUPERVISOR';
  query.id = 'v-1';
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  upload.mockReset();
  push.mockReset();
  position
    .mockReset()
    .mockResolvedValue({ coords: { latitude: -6.2, longitude: 106.8, accuracy: 8.4 } });
});
afterEach(() => vi.clearAllMocks());

describe('visits overview and per-depot view', () => {
  it('shows each depot with its counts, the unfenced and truncated notices, and an open visit to resume', async () => {
    serve({
      '/visits/api/v1/visits/mine/open': [visit()],
      [OVERVIEW]: {
        depots: [
          depot({ unfencedVisitsLast30d: 2 }),
          depot({
            depotId: 'd2',
            depotName: 'Depot Depok',
            lastVisitAt: null,
            overdueFollowUps: 0,
          }),
        ],
        truncated: true,
      },
    });
    render(<VisitsPage />);
    expect(await screen.findByText('Depot Bekasi')).toBeTruthy();
    expect(screen.getByText('opsFix.visits.neverVisited')).toBeTruthy();
    expect(screen.getByText('opsFix.visits.overdue|{"n":1}')).toBeTruthy();
    expect(screen.getByText('opsFix.visits.truncated')).toBeTruthy();
    expect(screen.getByText('opsFix.visits.unfenced|{"n":2}')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'opsFix.visits.resume' }).getAttribute('href')).toBe(
      '/dashboard/visits/detail?id=v-1',
    );
    expect(screen.getByRole('link', { name: 'opsFix.visits.start' }).getAttribute('href')).toBe(
      '/dashboard/visits/new',
    );
  });

  it('opens a depot: its findings and visits, and closes a follow-up with a note (Kepala)', async () => {
    auth.role = 'KEPALA_DEPOT';
    serve({
      '/visits/api/v1/visits/overview': { depots: [depot()], truncated: false },
      '/visits/api/v1/visits/findings': { items: [finding()], total: 1, page: 1, pageSize: 20 },
      '/visits/api/v1/visits?': {
        items: [
          {
            id: 'v-9',
            depotId: DEPOT,
            templateName: 'Rutin',
            visitorId: 'u-2',
            status: 'COMPLETED',
            checkInAt: '2026-11-20T03:00:00.000Z',
            completedAt: null,
            itemCount: 5,
            findingCount: 1,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    });
    patch.mockResolvedValue(finding({ followUpStatus: 'DONE' }));
    render(<VisitsPage />);
    // One depot in scope: its panel opens without a pick, and a Kepala holds no "start".
    expect(await screen.findByText('Bocor')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'opsFix.visits.start' })).toBeNull();
    expect(screen.getByText('Rutin').closest('a')?.getAttribute('href')).toBe(
      '/dashboard/visits/detail?id=v-9',
    );
    expect(get.mock.calls.some(([p]) => String(p).includes('/visits/mine/open'))).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'opsFix.visits.markDone' }));
    await userEvent.type(screen.getByLabelText('opsFix.visits.doneNote'), 'Sudah diperbaiki');
    await userEvent.click(screen.getByRole('button', { name: 'opsFix.visits.confirmDone' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(
        '/visits/api/v1/visits/findings/it-1/follow-up',
        { note: 'Sudah diperbaiki' },
        true,
      ),
    );
  });

  it('says so when closing fails, and a reader without visitFollowUp gets no close button', async () => {
    serve({
      '/visits/api/v1/visits/overview': { depots: [depot()], truncated: false },
      '/visits/api/v1/visits/findings': { items: [finding()], total: 1, page: 1, pageSize: 20 },
      '/visits/api/v1/visits?': { items: [], total: 0, page: 1, pageSize: 20 },
    });
    patch.mockRejectedValue(new FakeApiError(403, 'Bukan depot Anda'));
    auth.role = 'SUPERVISOR';
    const { unmount } = render(<VisitsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'opsFix.visits.markDone' }));
    await userEvent.click(screen.getByRole('button', { name: 'opsFix.visits.confirmDone' }));
    expect(await screen.findByText('Bukan depot Anda')).toBeTruthy();
    unmount();

    auth.role = 'HEAD_OFFICE';
    render(<VisitsPage />);
    expect(await screen.findByText('Bocor')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'opsFix.visits.markDone' })).toBeNull();
  });

  it('refuses a role without visitRead', async () => {
    auth.role = 'STAFF_DEPOT';
    render(<VisitsPage />);
    expect(await screen.findByText('opsFix.visits.gateTitle')).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });
});

describe('start a visit', () => {
  const setup = async () => {
    serve({
      [OVERVIEW]: { depots: [depot()], truncated: false },
      '/visit-templates/api/v1/visit-templates': [
        { id: 'tpl-1', name: 'Rutin', active: true, items: [] },
      ],
    });
    render(<NewVisitPage />);
    await userEvent.selectOptions(await screen.findByLabelText('opsFix.visits.new.depot'), DEPOT);
    await userEvent.selectOptions(screen.getByLabelText('opsFix.visits.new.template'), 'tpl-1');
  };
  const begin = () =>
    userEvent.click(screen.getByRole('button', { name: 'opsFix.visits.new.begin' }));

  it('sends the precise fix with its accuracy and opens the new visit', async () => {
    post.mockResolvedValue(visit({ id: 'v-new' }));
    await setup();
    await begin();
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/visits/api/v1/visits',
        { depotId: DEPOT, templateId: 'tpl-1', lat: -6.2, lng: 106.8, accuracyM: 8 },
        true,
      ),
    );
    expect(position).toHaveBeenCalledWith({ precise: true });
    expect(push).toHaveBeenCalledWith('/dashboard/visits/detail?id=v-new');
  });

  it.each([
    [
      '"Perkiraan" guidance',
      'Lokasi HP masih "Perkiraan" (bisa meleset sampai ±2 km), jadi kunjungan tidak bisa dimulai.',
    ],
    ['no depot point (422)', 'Depot ini belum punya titik lokasi. Minta HQ mengisinya.'],
    ['outside the area', 'Anda 640 m dari depot; kunjungan hanya bisa dimulai dalam 200 m.'],
  ])('shows the server refusal verbatim: %s', async (_name, message) => {
    post.mockRejectedValue(new FakeApiError(422, message));
    await setup();
    await begin();
    expect(await screen.findByText(message)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it('offers to resume when a visit is already open, and says a lost GPS signal', async () => {
    post.mockRejectedValueOnce(
      new FakeApiError(
        409,
        'Kunjungan di depot ini masih berjalan (id 00000000-0000-4000-8000-0000000000aa). Lanjutkan atau selesaikan dulu.',
        'VISIT_ALREADY_OPEN',
      ),
    );
    await setup();
    await begin();
    const resume = await screen.findByRole('link', { name: 'opsFix.visits.new.resumeExisting' });
    expect(resume.getAttribute('href')).toBe(
      '/dashboard/visits/detail?id=00000000-0000-4000-8000-0000000000aa',
    );

    position.mockRejectedValueOnce(new GeoError('timeout'));
    await begin();
    expect(await screen.findByText('errors.geo.timeout')).toBeTruthy();
  });

  it('refuses a role without visitConduct', async () => {
    auth.role = 'KEPALA_DEPOT';
    render(<NewVisitPage />);
    expect(await screen.findByText('opsFix.visits.gateTitle')).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });
});

describe('answer and complete a visit', () => {
  const photo = () =>
    new File([new Uint8Array([0xff, 0xd8, 0xff])], 'a.jpg', { type: 'image/jpeg' });

  it('passes a line at once and links the SOP version in force', async () => {
    serve({ '/visits/api/v1/visits/v-1': visit() });
    patch.mockResolvedValue(item({ result: 'PASS' }));
    render(<VisitDetailPage />);
    expect(
      (await screen.findByRole('link', { name: /opsFix.visits.detail.sop/ })).getAttribute('href'),
    ).toBe('/hr/me/sop/detail?id=sv-1');
    await userEvent.click(screen.getAllByRole('button', { name: 'opsFix.visits.detail.pass' })[0]!);
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(
        '/visits/api/v1/visits/v-1/items/it-1',
        { result: 'PASS' },
        true,
      ),
    );
    // The complete button waits for the other line.
    expect(
      (screen.getByRole('button', { name: 'opsFix.visits.detail.complete' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('records a finding with note, photo and deadline, then completes once every line is answered', async () => {
    serve({ '/visits/api/v1/visits/v-1': visit({ items: [item()] }) });
    upload.mockResolvedValue({ key: 'visits/v-1/abc.jpg' });
    patch.mockResolvedValue(finding());
    post.mockResolvedValue(
      visit({ status: 'COMPLETED', completedAt: '2026-11-27T04:00:00.000Z', items: [finding()] }),
    );
    render(<VisitDetailPage />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'opsFix.visits.detail.finding' }),
    );
    await userEvent.type(screen.getByLabelText('opsFix.visits.detail.noteLabel'), 'Bocor');
    await userEvent.upload(screen.getByLabelText('opsFix.visits.detail.photoLabel'), photo());
    expect(await screen.findByText('opsFix.visits.detail.photoReady')).toBeTruthy();
    expect(upload).toHaveBeenCalledWith('/visits/api/v1/visits/v-1/uploads', expect.any(File));
    const due = screen.getByLabelText('opsFix.visits.detail.dueLabel') as HTMLInputElement;
    expect(due.min).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await userEvent.type(due, '2026-12-01');
    await userEvent.click(screen.getByRole('button', { name: 'opsFix.visits.detail.saveFinding' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(
        '/visits/api/v1/visits/v-1/items/it-1',
        {
          result: 'FINDING',
          findingNote: 'Bocor',
          photoKey: 'visits/v-1/abc.jpg',
          followUpDueOn: '2026-12-01',
        },
        true,
      ),
    );

    const complete = await screen.findByRole('button', { name: 'opsFix.visits.detail.complete' });
    await waitFor(() => expect((complete as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(complete);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/visits/api/v1/visits/v-1/complete', {}, true),
    );
    expect(await screen.findByText('opsFix.visits.detail.readOnly')).toBeTruthy();
  });

  it('asks for what a finding lacks before sending anything', async () => {
    serve({ '/visits/api/v1/visits/v-1': visit({ items: [item()] }) });
    render(<VisitDetailPage />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'opsFix.visits.detail.finding' }),
    );
    const save = screen.getByRole('button', { name: 'opsFix.visits.detail.saveFinding' });
    await userEvent.click(save);
    expect(screen.getByText('opsFix.visits.detail.needNote')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('opsFix.visits.detail.noteLabel'), 'Bocor');
    await userEvent.click(save);
    expect(screen.getByText('opsFix.visits.detail.needPhoto')).toBeTruthy();
    expect(patch).not.toHaveBeenCalled();
  });

  it.each([
    [503, 'Penyimpanan foto kunjungan belum disiapkan'],
    [
      429,
      'Terlalu banyak foto untuk kunjungan ini. Pakai foto yang sudah diunggah atau selesaikan kunjungan.',
    ],
  ])('shows the upload refusal (%i) and keeps the note', async (status, message) => {
    serve({ '/visits/api/v1/visits/v-1': visit({ items: [item()] }) });
    upload.mockRejectedValue(new FakeApiError(status, message));
    render(<VisitDetailPage />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'opsFix.visits.detail.finding' }),
    );
    await userEvent.type(screen.getByLabelText('opsFix.visits.detail.noteLabel'), 'Bocor');
    await userEvent.upload(screen.getByLabelText('opsFix.visits.detail.photoLabel'), photo());
    expect(await screen.findByText(message)).toBeTruthy();
    expect(
      (screen.getByLabelText('opsFix.visits.detail.noteLabel') as HTMLTextAreaElement).value,
    ).toBe('Bocor');
  });

  it('falls back to its own storage text on a bare 503, and says a save or complete failure', async () => {
    serve({ '/visits/api/v1/visits/v-1': visit({ items: [item()] }) });
    upload.mockRejectedValueOnce(new FakeApiError(503, ''));
    patch.mockRejectedValue(
      new FakeApiError(409, 'Kunjungan ini sudah selesai dan tidak bisa diubah.'),
    );
    render(<VisitDetailPage />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'opsFix.visits.detail.finding' }),
    );
    await userEvent.upload(screen.getByLabelText('opsFix.visits.detail.photoLabel'), photo());
    expect(await screen.findByText('opsFix.visits.detail.photoStorage')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'opsFix.visits.cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'opsFix.visits.detail.pass' }));
    expect(
      await screen.findByText('Kunjungan ini sudah selesai dan tidak bisa diubah.'),
    ).toBeTruthy();
  });

  it('reads a completed visit without any controls, and a missing visit says so', async () => {
    serve({
      '/visits/api/v1/visits/v-1': visit({
        status: 'COMPLETED',
        completedAt: '2026-11-27T04:00:00.000Z',
        items: [finding()],
      }),
    });
    const { unmount } = render(<VisitDetailPage />);
    expect(await screen.findByText('Bocor')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'opsFix.visits.detail.pass' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'opsFix.visits.detail.complete' })).toBeNull();
    unmount();

    get.mockReset().mockRejectedValue(new FakeApiError(404, 'x'));
    render(<VisitDetailPage />);
    expect(await screen.findByText('opsFix.visits.detail.notFound')).toBeTruthy();
  });

  it('is read-only for a reader without visitConduct, even on an open visit', async () => {
    auth.role = 'KEPALA_DEPOT';
    serve({ '/visits/api/v1/visits/v-1': visit() });
    render(<VisitDetailPage />);
    expect(await screen.findByText(/Lantai bersih/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'opsFix.visits.detail.pass' })).toBeNull();
  });
});
