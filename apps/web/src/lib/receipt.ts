import { formatDateTime, formatIDR } from './format';
import { statusLabel } from './order-status';
import { printDocument } from './platform';
import type { Order } from './types';

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
export function printReceipt(
  order: Order,
  cash?: { cashReceived: number; change: number },
  method?: string,
): boolean {
  const rows = order.items
    .map(
      (it) =>
        `<tr><td>${esc(it.productName)}<br><small>${it.quantity} × ${formatIDR(it.unitPrice)}</small></td>` +
        `<td class="r">${formatIDR(it.lineTotal)}</td></tr>`,
    )
    .join('');

  const discount = order.discount > 0 ? `<tr><td>Diskon</td><td class="r">−${formatIDR(order.discount)}</td></tr>` : '';
  // Counter sale: the buyer expects to see what they handed over and what came back.
  const cashRows = cash
    ? `<tr><td>Tunai</td><td class="r">${formatIDR(cash.cashReceived)}</td></tr>` +
      `<tr><td>Kembali</td><td class="r">${formatIDR(cash.change)}</td></tr>`
    : '';
  // A non-cash counter sale has no tender rows, so without this the struk would not say how
  // it was paid at all — and a QRIS sale looks identical to an unpaid one.
  const methodRow = method ? `<tr><td>Metode</td><td class="r">${esc(method)}</td></tr>` : '';

  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8">
<title>Struk ${esc(order.orderNumber)}</title>
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
<div class="muted">Struk pesanan · ${esc(order.orderNumber)}</div>
<div class="muted">${formatDateTime(order.createdAt)} · ${esc(statusLabel(order.status))}</div>
<div class="muted" style="margin-top:8px">
  ${esc(order.recipientName)} · ${esc(order.phone)}<br>
  ${esc(order.addressLine)}, ${esc(order.city)}, ${esc(order.province)}
</div>
<table>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr><td>Subtotal</td><td class="r">${formatIDR(order.subtotal)}</td></tr>
    <tr><td>Ongkir</td><td class="r">${formatIDR(order.deliveryFee)}</td></tr>
    ${discount}
    <tr><td class="total">Total</td><td class="r total">${formatIDR(order.total)}</td></tr>
    ${methodRow}
    ${cashRows}
  </tfoot>
</table>
<p class="muted" style="text-align:center;margin-top:20px">Terima kasih telah memesan di Hydromart.</p>
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
