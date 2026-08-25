// Transactional WhatsApp notifications (PRD §19 Notification Matrix, FR-093/FR-094).
// Unlike broadcast campaigns (staff-authored, bulk), these are event-triggered, single
// recipient, and automated: upstream services (order-service) fire them on lifecycle
// changes. The message copy lives here (marketing-owned) rather than being scattered
// across the emitting services; callers pass only the event and template variables.

export enum NotificationEvent {
  ORDER_RECEIVED = 'ORDER_RECEIVED',
  /**
   * O6: a new order landed at a depot — addressed to the DEPOT's staff, not to the buyer.
   * Distinct from ORDER_RECEIVED, which is the customer's own "we have your order".
   */
  DEPOT_ORDER_INCOMING = 'DEPOT_ORDER_INCOMING',
  ORDER_CONFIRMED = 'ORDER_CONFIRMED',
  ORDER_ON_DELIVERY = 'ORDER_ON_DELIVERY',
  ORDER_DELIVERED = 'ORDER_DELIVERED',
  ORDER_COMPLETED = 'ORDER_COMPLETED',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
  // B6: the one transition where silence costs the customer something. BR-006 ends their
  // right to cancel the moment a courier is assigned, and nothing told them — the button
  // simply stopped being there. Tokens: {{name}}, {{orderNumber}}, {{driver}}.
  ORDER_DRIVER_ASSIGNED = 'ORDER_DRIVER_ASSIGNED',
  // B4: delivery-service has been sending this since reschedule shipped and it was never a
  // member here, so `@IsEnum` answered 400 and the sending adapter logged the refusal as a
  // warning and moved on. Every reschedule notification was lost between two services that
  // both believed they had done their part.
  // Tokens: {{orderNumber}}, {{rescheduledFor}}, {{slot}}, {{note}}.
  DELIVERY_RESCHEDULED = 'DELIVERY_RESCHEDULED',
  // Operational (not customer-facing): fired by depot-service when a stock line crosses
  // below its minimum. Recipient is an ops/warehouse number, not the customer.
  STOCK_LOW = 'STOCK_LOW',
  // Operational (not customer-facing): fired by depot-service when an order sold a
  // product the depot has no stock line for. The sale went through and nothing was
  // deducted, so the ledger will not show it — this warning is the only trace.
  // Tokens: {{depot}}, {{order}}, {{count}}. Recipient is the ops number.
  STOCK_UNTRACKED = 'STOCK_UNTRACKED',
  // Operational (not customer-facing): fired by order-service when a depot's daily
  // water-meter reading diverges from the litres its recorded sales account for.
  // Tokens: {{depot}}, {{date}}, {{variance}}, {{gallons}}. Recipient is the ops number.
  METER_VARIANCE = 'METER_VARIANCE',
  // Operational (not customer-facing): fired by delivery-service's SLA sweep when a
  // delivery is STILL ON THE ROAD past its depot's window — the one ops event about
  // something that has not finished going wrong yet. Tokens: {{order}}, {{minutes}},
  // {{threshold}}, {{over}}. Recipient is the ops number (depot staff when known).
  DELIVERY_SLA_BREACHED = 'DELIVERY_SLA_BREACHED',
  // Operational (not customer-facing): fired by delivery-service when a courier
  // reports a HIGH-severity field incident (design 4b). Tokens: {{severity}},
  // {{category}}, {{note}}. Recipient is the ops number.
  COURIER_INCIDENT = 'COURIER_INCIDENT',
  // Operational (not customer-facing): fired twice a day by order-service's cron with the
  // depot's gallon count so far. Tokens: {{slot}}, {{depot}}, {{gallons}}. Recipient is the
  // depot's own number, falling back to the ops number.
  DEPOT_SALES_UPDATE = 'DEPOT_SALES_UPDATE',
  // Account: fired by auth-service (via internal service auth) when a new customer
  // completes phone verification. Token: {{name}}.
  CUSTOMER_REGISTERED = 'CUSTOMER_REGISTERED',
  // Loyalty: fired by order-service on completion. Tokens: {{name}}, {{points}}, {{orderNumber}}.
  POINTS_EARNED = 'POINTS_EARNED',
  // Rewards/referral: fired when a voucher is granted. Tokens: {{name}}, {{code}}, {{description}}.
  VOUCHER_GRANTED = 'VOUCHER_GRANTED',
  // K4.2, agen-facing. What a reseller pays used to change with no trail, no date and no
  // message — they found out at the till, arguing with a cashier who was reading the
  // correct new price. Fired by customer-service on an immediate change AND by its
  // scheduled-change sweep. Tokens: {{name}}, {{terms}}.
  RESELLER_PRICE_CHANGED = 'RESELLER_PRICE_CHANGED',
  // The same moment, but the answer is "you are no longer an agen" — a deactivation reads
  // nothing like a new rate and must not be dressed as one. Tokens: {{name}}.
  RESELLER_DEACTIVATED = 'RESELLER_DEACTIVATED',
  // Retention nudge: "time to refill". Token: {{name}}.
  REORDER_REMINDER = 'REORDER_REMINDER',
  // HR (hr-service, internal key). Staff-facing, never customers. Leave events carry
  // {{name}}, {{type}}, {{from}}, {{to}}; a rejection adds {{reason}}. HR_ANNOUNCEMENT
  // carries {{title}} and {{body}}.
  LEAVE_SUBMITTED = 'LEAVE_SUBMITTED',
  LEAVE_APPROVED = 'LEAVE_APPROVED',
  LEAVE_REJECTED = 'LEAVE_REJECTED',
  HR_ANNOUNCEMENT = 'HR_ANNOUNCEMENT',
  // Marketing broadcast (Module 12). The one event whose copy is NOT owned here: staff
  // author the whole message in the HQ broadcast console, so the template is a bare
  // passthrough. It still goes through the same path as every other notification — an
  // inbox row plus best-effort push — which is exactly why it is an event at all.
  BROADCAST = 'BROADCAST',
}

// WhatsApp message templates (Bahasa Indonesia). Tokens: {{name}}, {{orderNumber}} for
// order events; {{depot}}, {{item}}, {{quantity}}, {{minimum}} for STOCK_LOW.
export const NOTIFICATION_TEMPLATES: Record<NotificationEvent, string> = {
  [NotificationEvent.ORDER_RECEIVED]:
    'Halo {{name}}! Pesanan {{orderNumber}} sudah kami terima dan sedang menunggu konfirmasi. Kami segera memprosesnya untukmu 💧',
  [NotificationEvent.DEPOT_ORDER_INCOMING]:
    'Pesanan baru masuk: {{orderNumber}} · {{total}}. Buka antrean untuk memprosesnya.',
  [NotificationEvent.ORDER_CONFIRMED]:
    'Halo {{name}}! Pesanan {{orderNumber}} sudah kami konfirmasi dan sedang kami siapkan. Terima kasih sudah memesan di Hydromart 💧',
  [NotificationEvent.ORDER_ON_DELIVERY]:
    'Kabar baik, {{name}}! Pesanan {{orderNumber}} sedang dalam perjalanan ke alamatmu. Mohon siapkan galon kosong bila ada penukaran ya.',
  [NotificationEvent.ORDER_DELIVERED]:
    'Pesanan {{orderNumber}} sudah sampai. Selamat menikmati air bersih dari Hydromart, {{name}}! 💧',
  [NotificationEvent.ORDER_COMPLETED]:
    'Terima kasih, {{name}}! Pesanan {{orderNumber}} selesai. Poin loyalti kamu sudah ditambahkan — cek saldo poin di aplikasi.',
  [NotificationEvent.ORDER_DRIVER_ASSIGNED]:
    'Halo {{name}}! Pesanan {{orderNumber}} sudah diambil kurir kami dan segera berangkat. Mulai sekarang pesanan tidak bisa dibatalkan sendiri lewat aplikasi — hubungi depot bila ada perubahan.',
  [NotificationEvent.DELIVERY_RESCHEDULED]:
    'Halo, pengiriman pesanan {{orderNumber}} dijadwalkan ulang ke {{rescheduledFor}} {{slot}}. {{note}} Mohon maaf atas ketidaknyamanannya.',
  [NotificationEvent.ORDER_CANCELLED]:
    'Halo {{name}}, pesanan {{orderNumber}} telah dibatalkan. Bila sudah ada pembayaran, dana dikembalikan sesuai metode pembayaranmu. Hubungi kami bila butuh bantuan.',
  [NotificationEvent.STOCK_LOW]:
    '⚠️ Stok menipis di depot {{depot}}: {{item}} tinggal {{quantity}} (minimum {{minimum}}). Segera lakukan pengisian ulang.',
  // K2.6: `{{stage}}` names the moment. The same order raises this twice — once when the
  // sale is PROMISED at checkout, once when it is FULFILLED with nothing deducted — and
  // without saying which, the second reads as a duplicate of the first and gets ignored.
  // The first is the one an operator can still act on.
  [NotificationEvent.STOCK_UNTRACKED]:
    '⚠️ {{stage}}: pesanan {{order}} di depot {{depot}} memuat {{count}} produk yang belum punya baris stok. Penjualannya tetap jalan, tapi stoknya TIDAK berkurang. Mohon buatkan baris stoknya.',
  [NotificationEvent.METER_VARIANCE]:
    '💧 Selisih meteran air depot {{depot}} tanggal {{date}}: {{variance}} liter (± {{gallons}} galon) dibanding penjualan tercatat. Mohon dicek.',
  [NotificationEvent.DELIVERY_SLA_BREACHED]:
    '⏰ Pesanan {{order}} sudah {{minutes}} menit di jalan — lewat batas SLA {{threshold}} menit ({{over}} menit terlambat). Mohon dicek kurirnya.',
  [NotificationEvent.COURIER_INCIDENT]:
    '🚨 Insiden {{severity}} dilaporkan kurir — {{category}}: {{note}}. Mohon segera ditindaklanjuti.',
  [NotificationEvent.DEPOT_SALES_UPDATE]:
    'Laporan penjualan {{slot}} depot {{depot}} : {{gallons}} Galon',
  [NotificationEvent.CUSTOMER_REGISTERED]:
    'Selamat datang di Hydromart, {{name}}! 💧 Akunmu sudah aktif. Pesan air bersih kapan saja lewat aplikasi kami. Terima kasih sudah bergabung!',
  [NotificationEvent.POINTS_EARNED]:
    'Mantap, {{name}}! Kamu dapat +{{points}} poin dari pesanan {{orderNumber}}. Kumpulkan poin untuk tukar voucher & naik tier di aplikasi.',
  [NotificationEvent.VOUCHER_GRANTED]:
    'Ada voucher baru untukmu, {{name}}! Kode {{code}} — {{description}}. Pakai saat checkout sebelum masa berlaku habis 🎟️',
  [NotificationEvent.RESELLER_PRICE_CHANGED]:
    'Halo {{name}}, harga agen kamu diperbarui: {{terms}}. Berlaku mulai sekarang — cek detailnya di aplikasi sebelum belanja berikutnya.',
  [NotificationEvent.RESELLER_DEACTIVATED]:
    'Halo {{name}}, status agen kamu dinonaktifkan, jadi pembelian berikutnya memakai harga umum. Hubungi depot bila ini tidak sesuai.',
  [NotificationEvent.REORDER_REMINDER]:
    'Halo {{name}}, galonmu mungkin sudah menipis. Pesan ulang sekarang, diantar cepat dari depot terdekat 💧',
  [NotificationEvent.LEAVE_SUBMITTED]:
    'Pengajuan cuti {{type}} dari {{name}} ({{from}} s/d {{to}}) menunggu persetujuan Anda.',
  [NotificationEvent.LEAVE_APPROVED]:
    'Halo {{name}}, cuti {{type}} tanggal {{from}} s/d {{to}} sudah DISETUJUI. Selamat beristirahat!',
  [NotificationEvent.LEAVE_REJECTED]:
    'Halo {{name}}, cuti {{type}} tanggal {{from}} s/d {{to}} DITOLAK. Alasan: {{reason}}. Silakan hubungi HR bila perlu.',
  [NotificationEvent.HR_ANNOUNCEMENT]: '📢 {{title}}\n{{body}}',
  [NotificationEvent.BROADCAST]: '{{message}}',
};

// Operational (staff-facing) events surfaced in the ops notification center (PRD 10d),
// as opposed to the customer inbox. STOCK_LOW is the operational alert today; add more
// staff-targeted events here as they are introduced.
export const OPS_EVENTS: NotificationEvent[] = [
  // O6: the depot's own "an order just arrived". The toggle for it has been on the ops
  // settings screen, defaulted ON, since before anything could emit it.
  NotificationEvent.DEPOT_ORDER_INCOMING,
  NotificationEvent.STOCK_LOW,
  NotificationEvent.STOCK_UNTRACKED,
  NotificationEvent.METER_VARIANCE,
  NotificationEvent.COURIER_INCIDENT,
  NotificationEvent.DEPOT_SALES_UPDATE,
  // HR events go to staff, so they belong in the ops feed, not a customer inbox. The
  // employee's own leave decisions included — the recipient is an employee either way.
  NotificationEvent.LEAVE_SUBMITTED,
  NotificationEvent.LEAVE_APPROVED,
  NotificationEvent.LEAVE_REJECTED,
  NotificationEvent.HR_ANNOUNCEMENT,
];

export function templateFor(event: NotificationEvent): string {
  return NOTIFICATION_TEMPLATES[event];
}

/** Pure, side-effect free. Replaces every {{key}} present in `vars`; unknown tokens are
 *  left intact so a typo surfaces visibly rather than silently blanking. */
export function renderMessage(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  );
}
