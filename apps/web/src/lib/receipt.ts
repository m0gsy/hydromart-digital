import { formatDateTime, formatIDR } from './format';
import { statusLabel } from './order-status';
import { printDocument } from './platform';
import { COLUMNS, getPaperMm } from './printer-prefs';
import { toPrintItems, type ThermalOutcome } from './receipt-thermal';
import type { Order } from './types';

/**
 * K3.4 — who actually sold this.
 *
 * The struk said "HYDROMART" and nothing else: not which depot, not which cashier, not
 * which shift. A customer coming back with a complaint held a piece of paper that named no
 * outlet, and a shift-close dispute had no way to tie a printed receipt to the till that
 * printed it — the two questions the paper exists to answer.
 *
 * Every field is optional because two callers print this. The counter knows all of them;
 * the order-detail screen prints a delivered order, which has a depot but no cashier and no
 * shift, and printing empty labels there would be worse than printing nothing.
 *
 * Non-PPN, decided: no NPWP line and no tax row. This is a commercial receipt, not a faktur
 * pajak. If a depot is ever registered as PKP that is a different document with different
 * legal requirements, not an extra line on this one.
 */
export interface ReceiptOutlet {
  depotName?: string | null;
  depotCity?: string | null;
  /** The depot's own line, so a buyer holding the paper knows who to call about it. */
  depotPhone?: string | null;
  cashierName?: string | null;
  /** The shift this sale was rung up in — what ties a paper receipt to a till count. */
  shiftId?: string | null;
}

/**
 * What a receipt says, independent of how it is drawn. The HTML template and the thermal
 * printer both render THIS, which is what stops the paper from drifting away from the
 * browser print the first time someone adds a line to one of them.
 *
 * Strings are plain text: escaping is the HTML renderer's job, not the model's.
 */
export interface ReceiptModel {
  docTitle: string;
  title: string;
  outlet: string[];
  subtitle: string;
  stamp: string;
  contact: string;
  address: string;
  items: { name: string; detail: string; total: string }[];
  totals: { label: string; value: string; strong?: boolean }[];
  thanks: string;
}

// Escape user/API text before inlining into the print HTML.
function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

export function buildReceiptModel(
  order: Order,
  t: (key: string) => string,
  cash?: { cashReceived: number; change: number },
  method?: string,
  outlet?: ReceiptOutlet,
): ReceiptModel {
  /*
   * K3.4. Each line appears only when the caller actually knows it — an empty "Kasir:" is
   * a worse answer than no line, because it reads as a till that recorded nobody.
   *
   * The shift id is shortened: it is there so a paper receipt can be matched to a shift
   * close, and eight characters do that while staying readable off thermal paper.
   */
  const outletLines = [
    outlet?.depotName
      ? `${outlet.depotName}${outlet.depotCity ? ` · ${outlet.depotCity}` : ''}`
      : '',
    outlet?.depotPhone ? `${t('hrFix.receipt.phone')}: ${outlet.depotPhone}` : '',
    outlet?.cashierName ? `${t('hrFix.receipt.cashier')}: ${outlet.cashierName}` : '',
    outlet?.shiftId ? `${t('hrFix.receipt.shift')}: ${outlet.shiftId.slice(0, 8)}` : '',
  ].filter(Boolean);

  const totals: ReceiptModel['totals'] = [
    { label: t('hrFix.receipt.subtotal'), value: formatIDR(order.subtotal) },
    { label: t('hrFix.receipt.deliveryFee'), value: formatIDR(order.deliveryFee) },
  ];
  if (order.discount > 0) {
    totals.push({ label: t('hrFix.receipt.discount'), value: `−${formatIDR(order.discount)}` });
  }
  totals.push({ label: t('hrFix.receipt.total'), value: formatIDR(order.total), strong: true });
  // A non-cash counter sale has no tender rows, so without this the struk would not say how
  // it was paid at all — and a QRIS sale looks identical to an unpaid one.
  if (method) totals.push({ label: t('hrFix.receipt.method'), value: method });
  // Counter sale: the buyer expects to see what they handed over and what came back.
  if (cash) {
    totals.push({ label: t('hrFix.receipt.cash'), value: formatIDR(cash.cashReceived) });
    totals.push({ label: t('hrFix.receipt.change'), value: formatIDR(cash.change) });
  }

  return {
    docTitle: `${t('hrFix.receipt.title')} ${order.orderNumber}`,
    title: 'HYDROMART',
    outlet: outletLines,
    subtitle: `${t('hrFix.receipt.subtitle')} · ${order.orderNumber}`,
    stamp: `${formatDateTime(order.createdAt)} · ${statusLabel(order.status)}`,
    contact: `${order.recipientName} · ${order.phone}`,
    address: `${order.addressLine}, ${order.city}${order.province ? `, ${order.province}` : ''}`,
    items: order.items.map((it) => ({
      name: it.productName,
      detail: `${it.quantity} × ${formatIDR(it.unitPrice)}`,
      total: formatIDR(it.lineTotal),
    })),
    totals,
    thanks: t('hrFix.receipt.thanks'),
  };
}

function renderHtml(model: ReceiptModel, locale: string, paperMm: number | null): string {
  const rows = model.items
    .map(
      (it) =>
        `<tr><td>${esc(it.name)}<br><small>${esc(it.detail)}</small></td>` +
        `<td class="r">${esc(it.total)}</td></tr>`,
    )
    .join('');
  const totals = model.totals
    .map((r) =>
      r.strong
        ? `<tr><td class="total">${esc(r.label)}</td><td class="r total">${esc(r.value)}</td></tr>`
        : `<tr><td>${esc(r.label)}</td><td class="r">${esc(r.value)}</td></tr>`,
    )
    .join('\n    ');
  const outletLines = model.outlet.map((l) => `<div class="muted">${esc(l)}</div>`).join('');
  // Only when the cashier has told us the roll width. The default stays the browser's own
  // page size: an office printer must keep printing A4, and a 420px column on a 58 mm roll
  // is what the till would have got without this.
  const rollCss = paperMm
    ? `\n  @page{size:${paperMm}mm auto;margin:0}` +
      `\n  @media print{body{max-width:none;margin:0;padding:2mm}}`
    : '';

  return `<!doctype html><html lang="${esc(locale)}"><head><meta charset="utf-8">
<title>${esc(model.docTitle)}</title>
<style>
  body{font-family:system-ui,sans-serif;color:#16282e;max-width:420px;margin:24px auto;padding:0 16px}
  h1{font-size:18px;margin:0 0 2px}.muted{color:#64757c;font-size:12px}
  table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
  td{padding:6px 0;border-bottom:1px solid #e9e7df;vertical-align:top}
  .r{text-align:right;white-space:nowrap}
  tfoot td{border:0;padding:3px 0}tfoot .total{font-weight:700;font-size:15px;border-top:2px solid #16282e;padding-top:8px}
  small{color:#64757c}${rollCss}
</style></head><body>
<h1>${esc(model.title)}</h1>
${outletLines}
<div class="muted">${esc(model.subtitle)}</div>
<div class="muted">${esc(model.stamp)}</div>
<div class="muted" style="margin-top:8px">
  ${esc(model.contact)}<br>
  ${esc(model.address)}
</div>
<table>
  <tbody>${rows}</tbody>
  <tfoot>
    ${totals}
  </tfoot>
</table>
<p class="muted" style="text-align:center;margin-top:20px">${esc(model.thanks)}</p>
<script>window.onload=function(){window.print()}</script>
</body></html>`;
}

/**
 * Printable order receipt / invoice (11e). Opens a clean print window built from the
 * order data and triggers the browser print dialog — "download PDF" is the browser's
 * own print-to-PDF. ponytail: no PDF library; a bespoke template + window.print covers
 * the ask with zero dependency.
 *
 * The receipt is built here, outside React, so the translator and the locale are passed
 * in rather than read from a hook. It is printed by the OPERATOR's console, so it follows
 * the operator's language — a depot running the console in English prints an English
 * receipt, and `lang` on the document says so instead of always claiming Indonesian.
 *
 * Returns false when the popup was blocked. The counter sale depends on that answer: a
 * blocked popup used to swallow the receipt silently, so the cashier watched the sale
 * succeed and the buyer walked off with nothing to hand back over.
 *
 * `onThermal` is called only when a saved thermal printer was tried and FAILED, after the
 * receipt has already been handed to the share sheet instead — so the cashier is told why
 * the printer stayed quiet, and still has the struk.
 */
export function printReceipt(
  order: Order,
  i18n: { t: (key: string) => string; locale: string },
  cash?: { cashReceived: number; change: number },
  method?: string,
  outlet?: ReceiptOutlet,
  onThermal?: (failure: Extract<ThermalOutcome, { kind: 'failed' }>) => void,
): boolean {
  const { t, locale } = i18n;
  const model = buildReceiptModel(order, t, cash, method, outlet);
  const paperMm = getPaperMm();
  const html = renderHtml(model, locale, paperMm);

  // An Android WebView supports neither `window.open` nor `window.print()`, and the
  // cashier console runs there. `printDocument` sends it to the saved thermal printer, or
  // shares it as a file when none is set up or the printer could not be reached.
  const roll = paperMm ?? 58;
  if (
    printDocument(html, {
      items: toPrintItems(model, COLUMNS[roll]),
      paperWidthMm: roll,
      onFailed: onThermal,
    })
  ) {
    return true;
  }

  const w = window.open('', '_blank', 'width=480,height=640');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}
