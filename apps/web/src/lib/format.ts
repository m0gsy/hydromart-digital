// Pure formatting helpers. Covered by test/format.test.ts.

// Plain number grouping (id-ID uses "." as the thousands separator), then a
// literal "Rp " prefix — avoids the locale currency-symbol spacing (Intl inserts
// a non-breaking space) that makes the output awkward to assert on.
const rupiah = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

/** Format a number of Rupiah, e.g. 20000 -> "Rp 20.000". */
export function formatIDR(amount: number): string {
  return `Rp ${rupiah.format(amount)}`;
}

const dateFmt = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDateTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return dateFmt.format(d);
}

/**
 * Normalise an Indonesian mobile number to E.164-ish local form for display.
 * Leaves the value largely intact — the backend does authoritative validation.
 */
export function normalizePhone(input: string): string {
  const trimmed = input.replace(/[\s-]/g, '');
  if (trimmed.startsWith('+')) return trimmed;
  if (trimmed.startsWith('0')) return trimmed;
  if (trimmed.startsWith('62')) return `+${trimmed}`;
  return trimmed;
}
