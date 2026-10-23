import type { ReceiptModel } from '@/lib/receipt';

/**
 * The receipt as plain text, for a chat message.
 *
 * Built from the same `ReceiptModel` the printed and thermal receipts render, so a struk
 * sent to a phone can never say something different from the paper in the buyer's hand. The
 * recipient line and address are left out: the buyer is the recipient, and at a counter the
 * "address" is only the depot's own pick-up point.
 */
export function receiptToText(m: ReceiptModel): string {
  const lines: string[] = [m.title, ...m.outlet, m.subtitle, m.stamp, ''];
  for (const it of m.items) lines.push(`${it.name} ${it.detail}`.trim() + ` — ${it.total}`);
  lines.push('');
  for (const row of m.totals) lines.push(`${row.label}: ${row.value}`);
  if (m.thanks) lines.push('', m.thanks);
  return lines.join('\n');
}

/**
 * A `wa.me` link for the number the cashier already collected, or null when it cannot be a
 * real one. Indonesian local form (0812…) becomes 62812…; a number already in international
 * form is kept. Anything that is not 9–15 digits afterwards is refused — a link to a wrong
 * number would send a stranger a receipt.
 */
export function whatsappUrl(phone: string, text: string): string | null {
  const digits = phone.replace(/\D/g, '');
  let intl = digits;
  if (digits.startsWith('0')) intl = `62${digits.slice(1)}`;
  else if (digits.startsWith('8')) intl = `62${digits}`;
  if (!/^62\d{8,13}$/.test(intl)) return null;
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}
