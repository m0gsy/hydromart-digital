import { formatDateTime, formatIDR } from './format';
import { statusLabel } from './order-status';
import { printDocument } from './platform';
import type { Order } from './types';

/**
 * K3.4 — who actually sold this.
 *
 * The struk said "HYDROMART" and nothing else: not which depot, not which cashier, not
 * which shift. A customer coming back with a complaint held a piece of paper that named no
 * outlet, and a shift-close dispute had no way to tie a printed receipt to the till that
 * printed it — the two questions the paper exists to answer.
 *
 * Every field is optional because two callers print this. The counter knows all four; the
 * order-detail screen prints a delivered order, which has a depot but no cashier and no
 * shift, and printing empty labels there would be worse than printing nothing.
 *
 * Non-PPN, decided: no NPWP line and no tax row. This is a commercial receipt, not a faktur
 * pajak. If a depot is ever registered as PKP that is a different document with different
 * legal requirements, not an extra line on this one.
 */
export interface ReceiptOutlet {
  depotName?: string | null;
  depotCity?: string | null;
  cashierName?: string | null;
  /** The shift this sale was rung up in — what ties a paper receipt to a till count. */
  shiftId?: string | null;
}

// Escape user/API text before inlining into the print HTML.
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

/**
 * Printable order receipt / invoice (11e). Opens a clean print window built from the
 * order data and triggers the browser print dialog — "download PDF" is the browser's
 * own print-to-PDF. ponytail: no PDF library; a bespoke template + window.print covers
 * the ask with zero dependency.
 *
 * Returns false when the popup was blocked. The counter sale depends on that answer: a
 * blocked popup used to swallow the receipt silently, so the cashier watched the sale
 * succeed and the buyer walked off with nothing to hand back over.
 */
/**
 * The receipt is built here, outside React, so the translator and the locale are passed
 * in rather than read from a hook. It is printed by the OPERATOR's console, so it follows
 * the operator's language — a depot running the console in English prints an English
 * receipt, and `lang` on the document says so instead of always claiming Indonesian.
 */
export function printReceipt(
  order: Order,
  i18n: { t: (key: string) => string; locale: string },
  cash?: { cashReceived: number; change: number },
  method?: string,
  outlet?: ReceiptOutlet,
): boolean {
  const { t, locale } = i18n;
  const rows = order.items
    .map(
      (it) =>
        `<tr><td>${esc(it.productName)}<br><small>${it.quantity} × ${formatIDR(it.unitPrice)}</small></td>` +
        `<td class="r">${formatIDR(it.lineTotal)}</td></tr>`,
    )
    .join('');

  const discount = order.discount > 0 ? `<tr><td>${esc(t('hrFix.receipt.discount'))}</td><td class="r">−${formatIDR(order.discount)}</td></tr>` : '';
  // Counter sale: the buyer expects to see what they handed over and what came back.
  const cashRows = cash
    ? `<tr><td>${esc(t('hrFix.receipt.cash'))}</td><td class="r">${formatIDR(cash.cashReceived)}</td></tr>` +
      `<tr><td>${esc(t('hrFix.receipt.change'))}</td><td class="r">${formatIDR(cash.change)}</td></tr>`
    : '';
  // A non-cash counter sale has no tender rows, so without this the struk would not say how
  // it was paid at all — and a QRIS sale looks identical to an unpaid one.
  const methodRow = method ? `<tr><td>${esc(t('hrFix.receipt.method'))}</td><td class="r">${esc(method)}</td></tr>` : '';

  /*
   * K3.4. Each line appears only when the caller actually knows it — an empty "Kasir:" is
   * a worse answer than no line, because it reads as a till that recorded nobody.
   *
   * The shift id is shortened: it is there so a paper receipt can be matched to a shift
   * close, and eight characters do that while staying readable off thermal paper.
   */
  const outletLines = [
    outlet?.depotName
      ? `<div class="muted">${esc(outlet.depotName)}${outlet.depotCity ? ` · ${esc(outlet.depotCity)}` : ''}</div>`
      : '',
    outlet?.cashierName
      ? `<div class="muted">${esc(t('hrFix.receipt.cashier'))}: ${esc(outlet.cashierName)}</div>`
      : '',
    outlet?.shiftId
      ? `<div class="muted">${esc(t('hrFix.receipt.shift'))}: ${esc(outlet.shiftId.slice(0, 8))}</div>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  const html = `<!doctype html><html lang="${esc(locale)}"><head><meta charset="utf-8">
<title>${esc(t('hrFix.receipt.title'))} ${esc(order.orderNumber)}</title>
<style>
  body{font-family:system-ui,sans-serif;color:#16282e;max-width:420px;margin:24px auto;padding:0 16px}
  h1{font-size:18px;margin:0 0 2px}.muted{color:#64757c;font-size:12px}
  table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
  td{padding:6px 0;border-bottom:1px solid #e9e7df;vertical-align:top}
  .r{text-align:right;white-space:nowrap}
  tfoot td{border:0;padding:3px 0}tfoot .total{font-weight:700;font-size:15px;border-top:2px solid #16282e;padding-top:8px}
  small{color:#64757c}
</style></head><body>
<h1>HYDROMART</h1>
${outletLines}
<div class="muted">${esc(t('hrFix.receipt.subtitle'))} · ${esc(order.orderNumber)}</div>
<div class="muted">${formatDateTime(order.createdAt)} · ${esc(statusLabel(order.status))}</div>
<div class="muted" style="margin-top:8px">
  ${esc(order.recipientName)} · ${esc(order.phone)}<br>
  ${esc(order.addressLine)}, ${esc(order.city)}, ${esc(order.province)}
</div>
<table>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr><td>${esc(t('hrFix.receipt.subtotal'))}</td><td class="r">${formatIDR(order.subtotal)}</td></tr>
    <tr><td>${esc(t('hrFix.receipt.deliveryFee'))}</td><td class="r">${formatIDR(order.deliveryFee)}</td></tr>
    ${discount}
    <tr><td class="total">${esc(t('hrFix.receipt.total'))}</td><td class="r total">${formatIDR(order.total)}</td></tr>
    ${methodRow}
    ${cashRows}
  </tfoot>
</table>
<p class="muted" style="text-align:center;margin-top:20px">${esc(t('hrFix.receipt.thanks'))}</p>
<script>window.onload=function(){window.print()}</script>
</body></html>`;

  // An Android WebView supports neither `window.open` nor `window.print()`, and the
  // cashier console runs there. F3 fills this in; until then the caller's existing
  // failure handling is what a native user sees, which is at least honest.
  if (printDocument(html)) return true;

  const w = window.open('', '_blank', 'width=480,height=640');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}
