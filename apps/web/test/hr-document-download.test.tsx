// @vitest-environment jsdom
/**
 * SEC-01 — the personal file stops being a public link.
 *
 * HR documents (KTP, KK, contract, payslip) were listed with `fileUrl`: a permanent,
 * unsigned object-storage address, rendered as a plain link. Anybody who had ever seen one
 * kept it for good, and opening it involved no session at all — a signed-out browser, a
 * copied WhatsApp message, a search engine that ever crawled the bucket.
 *
 * The rule this pins: the screen fetches the bytes through the API with the session
 * attached, and no storage URL is rendered anywhere on it.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getBlob, downloadBlob } = vi.hoisted(() => ({
  get: vi.fn(),
  getBlob: vi.fn(),
  downloadBlob: vi.fn(),
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get }, getBlob };
});
vi.mock('@/lib/csv', async () => {
  const actual = await vi.importActual<typeof import('@/lib/csv')>('@/lib/csv');
  return { ...actual, downloadBlob };
});

import { EmployeeDocuments } from '@/components/hr/employee-documents';
import { ToastProvider } from '@/components/toast';
import { LocaleProvider } from '@/lib/locale-context';
import { endpoints } from '@/lib/endpoints';

const DOC = {
  id: 'doc-1',
  employeeId: 'emp-1',
  type: 'KTP',
  // What the server USED to send, kept in the fixture on purpose: if the row ever carries
  // a storage URL again, the first test sees it rendered.
  fileUrl: 'https://cdn.example.com/hr/documents/ktp.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 1234,
  version: 2,
  supersededById: null,
  expiresAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
};

function show() {
  render(
    <LocaleProvider>
      <ToastProvider>
        <EmployeeDocuments employeeId="emp-1" isAdmin={false} />
      </ToastProvider>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  get.mockReset().mockResolvedValue([DOC]);
  getBlob.mockReset().mockResolvedValue(new Blob(['bytes']));
  downloadBlob.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('SEC-01 · an HR document is fetched with the session, not linked to', () => {
  it('renders no link to storage at all', async () => {
    show();
    await waitFor(() => expect(screen.getByText(/KTP/i)).toBeTruthy());

    for (const anchor of document.querySelectorAll('a')) {
      expect(anchor.getAttribute('href') ?? '').not.toMatch(/^https?:/);
    }
  });

  it('asks the authenticated file route for the bytes when opened', async () => {
    show();
    await waitFor(() => expect(screen.getByText(/KTP/i)).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: /lihat|view|buka/i }));

    await waitFor(() =>
      expect(getBlob).toHaveBeenCalledWith(endpoints.hr.employeeDocumentFile('doc-1')),
    );
    expect(downloadBlob).toHaveBeenCalled();
  });
});
