// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadBlob } from '@/lib/csv';

/**
 * A saved file has to be openable, and on Windows and Android that means an extension.
 *
 * Two callers could not spell one, because the type is only known once the bytes arrive:
 * the attendance photo saved as `absensi-2026-08-18-in` and an employee document as
 * `KTP-v1`. Both were real JPEGs and PDFs that the OS could make nothing of — the file
 * downloaded, and then looked like nothing at all.
 *
 * The rule is narrow on purpose: append only when the name has none AND the type is one we
 * can name. Guessing is worse than leaving it off — a `.jpg` that is really a PDF opens to
 * an error instead of to nothing.
 */
function captured(): { name: string | null } {
  const out: { name: string | null } = { name: null };
  const el = {
    set download(v: string) {
      out.name = v;
    },
    set href(_v: string) {},
    click() {},
  } as unknown as HTMLAnchorElement;
  vi.spyOn(document, 'createElement').mockReturnValue(el);
  return out;
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

describe('a downloaded file is named so it opens', () => {
  it.each([
    ['image/jpeg', 'absensi-2026-08-18-in', 'absensi-2026-08-18-in.jpg'],
    ['image/png', 'absensi-2026-08-18-out', 'absensi-2026-08-18-out.png'],
    ['application/pdf', 'KTP-v1', 'KTP-v1.pdf'],
    // A content type may carry parameters; they are not part of the type.
    ['image/jpeg; charset=binary', 'foto', 'foto.jpg'],
  ])('%s → %s becomes %s', (type, given, want) => {
    const out = captured();
    downloadBlob(given, new Blob(['x'], { type }));
    expect(out.name).toBe(want);
  });

  it('leaves a name that already carries its own extension alone', () => {
    const out = captured();
    downloadBlob('slip-abc.pdf', new Blob(['x'], { type: 'application/pdf' }));
    expect(out.name).toBe('slip-abc.pdf');
  });

  /*
   * An unknown type gets nothing appended. A wrong extension is worse than none: the OS
   * opens the file with the wrong application and shows an error, instead of asking.
   */
  it('appends nothing for a type it cannot name', () => {
    const out = captured();
    downloadBlob('sesuatu', new Blob(['x'], { type: 'application/x-unknown' }));
    expect(out.name).toBe('sesuatu');
  });

  it('appends nothing when the server sent no type at all', () => {
    const out = captured();
    downloadBlob('sesuatu', new Blob(['x']));
    expect(out.name).toBe('sesuatu');
  });
});
