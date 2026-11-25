// @vitest-environment jsdom
//
// HD-15B PR-3 - the HQ visit-template screen: the list (retired ones included) and the form that
// writes a template's whole checklist. The server checks every bound again; these tests hold the
// screen to showing what it was told and to sending what the person typed, in the order shown.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, put, toast, FakeApiError } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
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

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, put },
  ApiError: FakeApiError,
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, vars?: Record<string, unknown>) => (vars ? `${k}|${JSON.stringify(vars)}` : k),
    locale: 'id',
  }),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));

import HqVisitTemplatesPage from '@/app/hq/visit-templates/page';

const SOP1 = '00000000-0000-4000-8000-0000000000a1';
const SOP_GONE = '00000000-0000-4000-8000-0000000000a9';
const TEMPLATES = '/visit-templates/api/v1/visit-templates/manage';
const SOPS = '/sops/api/v1/sops';

const template = (over: Record<string, unknown> = {}) => ({
  id: 'tpl-1',
  name: 'Kunjungan rutin',
  active: true,
  createdAt: '2026-11-27T00:00:00.000Z',
  updatedAt: '2026-11-27T00:00:00.000Z',
  items: [
    { id: 'i1', position: 0, text: 'Lantai bersih', sopId: null },
    { id: 'i2', position: 1, text: 'Filter diganti', sopId: SOP1 },
  ],
  ...over,
});

const sopList = [{ id: SOP1, title: 'SOP filter' }];

function serve(templates: unknown[], sops: unknown = sopList) {
  get.mockImplementation(async (path: string) => {
    if (path === TEMPLATES) return templates;
    if (path === SOPS) {
      if (sops instanceof Error) throw sops;
      return sops;
    }
    throw new Error(`unexpected ${path}`);
  });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset().mockResolvedValue({});
  put.mockReset().mockResolvedValue({});
  toast.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('the visit template list', () => {
  it('shows each template with its size and whether it is active', async () => {
    serve([template(), template({ id: 'tpl-2', name: 'Lama', active: false })]);
    render(<HqVisitTemplatesPage />);
    expect(await screen.findByText('Kunjungan rutin')).toBeTruthy();
    expect(screen.getAllByText('hq.visitTemplates.itemCount|{"n":2}')).toHaveLength(2);
    expect(screen.getByText('hq.visitTemplates.active')).toBeTruthy();
    expect(screen.getByText('hq.visitTemplates.retired')).toBeTruthy();
    expect(get).toHaveBeenCalledWith(TEMPLATES, true);
  });

  it('says there is nothing yet, and says so when the read failed', async () => {
    serve([]);
    const view = render(<HqVisitTemplatesPage />);
    expect(await screen.findByText('hq.visitTemplates.empty')).toBeTruthy();
    view.unmount();
    get.mockReset().mockRejectedValue(new FakeApiError(500, 'down'));
    render(<HqVisitTemplatesPage />);
    expect(await screen.findByText('hq.visitTemplates.loadError')).toBeTruthy();
  });
});

describe('writing a template', () => {
  it('creates one from the lines typed, in order, with the SOP picked, then reloads', async () => {
    serve([]);
    const user = userEvent.setup();
    render(<HqVisitTemplatesPage />);
    await user.click(await screen.findByText('hq.visitTemplates.add'));
    const submit = screen.getByText('hq.visitTemplates.form.submit').closest('button') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    await user.type(screen.getByLabelText('hq.visitTemplates.form.name'), 'Rutin bulanan');
    await user.type(screen.getByLabelText('hq.visitTemplates.form.itemText|{"n":1}'), 'Lantai bersih');
    expect(submit.disabled).toBe(false);
    await user.click(screen.getByText('hq.visitTemplates.form.addItem'));
    await user.type(screen.getByLabelText('hq.visitTemplates.form.itemText|{"n":2}'), 'Filter diganti');
    await user.selectOptions(screen.getAllByLabelText('hq.visitTemplates.form.sop')[1] as HTMLElement, SOP1);

    get.mockClear();
    await user.click(submit);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith(
      '/visit-templates/api/v1/visit-templates',
      { name: 'Rutin bulanan', items: [{ text: 'Lantai bersih' }, { text: 'Filter diganti', sopId: SOP1 }] },
      true,
    );
    expect(toast).toHaveBeenCalledWith('hq.visitTemplates.form.saved', 'success');
    await waitFor(() => expect(get).toHaveBeenCalledWith(TEMPLATES, true));
    expect(screen.queryByText('hq.visitTemplates.form.submit')).toBeNull();
  });

  it('refuses a line shorter than three characters before it sends anything', async () => {
    serve([]);
    const user = userEvent.setup();
    render(<HqVisitTemplatesPage />);
    await user.click(await screen.findByText('hq.visitTemplates.add'));
    await user.type(screen.getByLabelText('hq.visitTemplates.form.name'), 'Rutin');
    await user.type(screen.getByLabelText('hq.visitTemplates.form.itemText|{"n":1}'), 'ab');
    expect((screen.getByText('hq.visitTemplates.form.submit').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect(post).not.toHaveBeenCalled();
  });

  it('edits a template: replaces the whole list, keeps a SOP the list no longer returns, reorders and removes', async () => {
    const tpl = template({
      items: [
        { id: 'i1', position: 0, text: 'Lantai bersih', sopId: null },
        { id: 'i2', position: 1, text: 'Filter diganti', sopId: SOP1 },
        { id: 'i3', position: 2, text: 'Genset dicek', sopId: SOP_GONE },
      ],
    });
    serve([tpl]);
    const user = userEvent.setup();
    render(<HqVisitTemplatesPage />);
    await user.click(await screen.findByText('hq.visitTemplates.edit'));
    expect((screen.getByLabelText('hq.visitTemplates.form.name') as HTMLInputElement).value).toBe('Kunjungan rutin');
    // the SOP the server no longer lists stays selectable as "unknown"
    expect(await screen.findByText('hq.visitTemplates.sopUnknown')).toBeTruthy();

    await user.click(screen.getByLabelText('hq.visitTemplates.form.moveDown|{"n":1}'));
    await user.click(screen.getByLabelText('hq.visitTemplates.form.moveUp|{"n":3}'));
    await user.click(screen.getByLabelText('hq.visitTemplates.form.removeItem|{"n":1}'));
    await user.click(screen.getByLabelText('hq.visitTemplates.form.active'));

    await user.click(screen.getByText('hq.visitTemplates.form.submit'));
    await waitFor(() => expect(put).toHaveBeenCalled());
    // after move down (1<->2) then move up (3<->2): [Filter, Genset, Lantai]; Filter removed.
    expect(put).toHaveBeenCalledWith(
      '/visit-templates/api/v1/visit-templates/tpl-1',
      {
        name: 'Kunjungan rutin',
        active: false,
        items: [{ text: 'Genset dicek', sopId: SOP_GONE }, { text: 'Lantai bersih' }],
        seenUpdatedAt: '2026-11-27T00:00:00.000Z',
      },
      true,
    );
  });

  it('cannot move past the ends or remove the last line, and caps the list at 60', async () => {
    serve([template({ items: [{ id: 'i1', position: 0, text: 'Satu butir', sopId: null }] })]);
    const user = userEvent.setup();
    render(<HqVisitTemplatesPage />);
    await user.click(await screen.findByText('hq.visitTemplates.edit'));
    expect((screen.getByLabelText('hq.visitTemplates.form.moveUp|{"n":1}') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('hq.visitTemplates.form.moveDown|{"n":1}') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('hq.visitTemplates.form.removeItem|{"n":1}') as HTMLButtonElement).disabled).toBe(true);

    const add = screen.getByText('hq.visitTemplates.form.addItem').closest('button') as HTMLButtonElement;
    for (let i = 0; i < 59; i++) await user.click(add);
    expect(add.disabled).toBe(true);
    expect(screen.getByText('hq.visitTemplates.form.limit')).toBeTruthy();
  });

  it('shows the server refusal text and keeps the form open when saving fails', async () => {
    serve([]);
    post.mockRejectedValueOnce(new FakeApiError(400, 'Nama sudah dipakai'));
    const user = userEvent.setup();
    render(<HqVisitTemplatesPage />);
    await user.click(await screen.findByText('hq.visitTemplates.add'));
    await user.type(screen.getByLabelText('hq.visitTemplates.form.name'), 'Rutin');
    await user.type(screen.getByLabelText('hq.visitTemplates.form.itemText|{"n":1}'), 'Lantai bersih');
    await user.click(screen.getByText('hq.visitTemplates.form.submit'));
    expect(await screen.findByText('Nama sudah dipakai')).toBeTruthy();

    post.mockRejectedValueOnce(new Error('boom'));
    await user.click(screen.getByText('hq.visitTemplates.form.submit'));
    expect(await screen.findByText('hq.visitTemplates.form.saveError')).toBeTruthy();
    expect(screen.getByText('hq.visitTemplates.form.submit')).toBeTruthy();
  });

  it('drops the form and re-reads the list when another editor saved first', async () => {
    serve([template()]);
    put.mockRejectedValueOnce(new FakeApiError(409, 'sudah diubah', 'STALE_WRITE'));
    const user = userEvent.setup();
    render(<HqVisitTemplatesPage />);
    await user.click(await screen.findByText('hq.visitTemplates.edit'));
    get.mockClear();
    await user.click(screen.getByText('hq.visitTemplates.form.submit'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('hq.common.staleWrite', 'error'));
    await waitFor(() => expect(get).toHaveBeenCalledWith(TEMPLATES, true));
    expect(screen.queryByText('hq.visitTemplates.form.submit')).toBeNull();
  });

  it('still lets a template be written when the SOP list will not load', async () => {
    serve([], new FakeApiError(503, 'hr down'));
    const user = userEvent.setup();
    render(<HqVisitTemplatesPage />);
    await user.click(await screen.findByText('hq.visitTemplates.add'));
    expect(await screen.findByText('hq.visitTemplates.form.sopLoadError')).toBeTruthy();
    await user.type(screen.getByLabelText('hq.visitTemplates.form.name'), 'Rutin');
    await user.type(screen.getByLabelText('hq.visitTemplates.form.itemText|{"n":1}'), 'Lantai bersih');
    await user.click(screen.getByText('hq.visitTemplates.form.submit'));
    await waitFor(() => expect(post).toHaveBeenCalled());
  });

  it('closes the form without saving on cancel', async () => {
    serve([]);
    const user = userEvent.setup();
    render(<HqVisitTemplatesPage />);
    await user.click(await screen.findByText('hq.visitTemplates.add'));
    await user.click(screen.getByText('hq.visitTemplates.form.cancel'));
    expect(screen.queryByText('hq.visitTemplates.form.submit')).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
});
