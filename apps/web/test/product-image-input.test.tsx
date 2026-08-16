// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { uploadFile } = vi.hoisted(() => ({ uploadFile: vi.fn() }));

// ApiError must stay a real class — the component branches on `instanceof` to decide
// whether to show the server's own message or its generic fallback.
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ApiError: actual.ApiError, uploadFile };
});

import { ApiError } from '@/lib/api';
import { LocaleProvider } from '@/lib/locale-context';
import { ProductImageInput } from '@/components/product-image-input';

/** A File the size check will see as `bytes` long without allocating that many. */
function fileOf(bytes: number, name = 'foto.jpg'): File {
  const file = new File(['x'], name, { type: 'image/jpeg' });
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
}

// Block body on purpose: `mockReset()` returns the mock, and a function returned from
// `beforeEach` is registered as vitest's cleanup hook — so the concise-arrow form has the
// runner CALL the mock during teardown, and a rejecting implementation then fails a test
// that had already passed.
beforeEach(() => {
  uploadFile.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('ProductImageInput', () => {
  it('uploads a picked file and hands back the URL the server returned', async () => {
    uploadFile.mockResolvedValue({ url: 'https://cdn.example/products/a.jpg' });
    const onChange = vi.fn();
    render(<ProductImageInput value="" onChange={onChange} />, { wrapper: LocaleProvider });

    await userEvent.upload(screen.getByLabelText(/pilih berkas foto/i), fileOf(1024));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://cdn.example/products/a.jpg'));
  });

  it('refuses a file over 5 MB without calling the server', async () => {
    const onChange = vi.fn();
    render(<ProductImageInput value="" onChange={onChange} />, { wrapper: LocaleProvider });

    await userEvent.upload(screen.getByLabelText(/pilih berkas foto/i), fileOf(6 * 1024 * 1024));

    expect(await screen.findByRole('alert')).toHaveTextContent(/5 MB/);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows the server's own rejection rather than a generic failure", async () => {
    // What a magic-byte rejection actually looks like coming back through the gateway.
    // An async function that throws, not `mockRejectedValue`: the latter builds the
    // rejected promise at mock-setup time, so it sits unhandled until the upload finally
    // awaits it and the runner fails the test before the component ever sees the error.
    uploadFile.mockImplementation(async () => {
      throw new ApiError(400, 'Berkas itu bukan gambar.');
    });
    render(<ProductImageInput value="" onChange={vi.fn()} />, { wrapper: LocaleProvider });

    await userEvent.upload(screen.getByLabelText(/pilih berkas foto/i), fileOf(1024));

    expect(await screen.findByRole('alert')).toHaveTextContent('Berkas itu bukan gambar.');
  });

  it('offers replace instead of upload once a photo is set, and can clear it', async () => {
    const onRemove = vi.fn();
    render(<ProductImageInput value="https://cdn.example/a.jpg" onChange={vi.fn()} onRemove={onRemove} />, {
      wrapper: LocaleProvider,
    });

    expect(screen.getByRole('button', { name: /ganti foto/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /hapus foto/i }));
    expect(onRemove).toHaveBeenCalled();
  });
});
