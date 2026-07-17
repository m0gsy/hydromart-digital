// Transactional WhatsApp notifications (PRD §19 Notification Matrix, FR-093/FR-094).
// Unlike broadcast campaigns (staff-authored, bulk), these are event-triggered, single
// recipient, and automated: upstream services (order-service) fire them on lifecycle
// changes. The message copy lives here (marketing-owned) rather than being scattered
// across the emitting services; callers pass only the event and template variables.

export enum NotificationEvent {
  ORDER_RECEIVED = 'ORDER_RECEIVED',
  ORDER_CONFIRMED = 'ORDER_CONFIRMED',
  ORDER_ON_DELIVERY = 'ORDER_ON_DELIVERY',
  ORDER_DELIVERED = 'ORDER_DELIVERED',
  ORDER_COMPLETED = 'ORDER_COMPLETED',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
  // Operational (not customer-facing): fired by depot-service when a stock line crosses
  // below its minimum. Recipient is an ops/warehouse number, not the customer.
  STOCK_LOW = 'STOCK_LOW',
  // Operational (not customer-facing): fired by delivery-service when a courier
  // reports a HIGH-severity field incident (design 4b). Tokens: {{severity}},
  // {{category}}, {{note}}. Recipient is the ops number.
  COURIER_INCIDENT = 'COURIER_INCIDENT',
  // Account: fired by auth-service (via internal service auth) when a new customer
  // completes phone verification. Token: {{name}}.
  CUSTOMER_REGISTERED = 'CUSTOMER_REGISTERED',
  // Loyalty: fired by order-service on completion. Tokens: {{name}}, {{points}}, {{orderNumber}}.
  POINTS_EARNED = 'POINTS_EARNED',
  // Rewards/referral: fired when a voucher is granted. Tokens: {{name}}, {{code}}, {{description}}.
  VOUCHER_GRANTED = 'VOUCHER_GRANTED',
  // Retention nudge: "time to refill". Token: {{name}}.
  REORDER_REMINDER = 'REORDER_REMINDER',
}

// WhatsApp message templates (Bahasa Indonesia). Tokens: {{name}}, {{orderNumber}} for
// order events; {{depot}}, {{item}}, {{quantity}}, {{minimum}} for STOCK_LOW.
export const NOTIFICATION_TEMPLATES: Record<NotificationEvent, string> = {
  [NotificationEvent.ORDER_RECEIVED]:
    'Halo {{name}}! Pesanan {{orderNumber}} sudah kami terima dan sedang menunggu konfirmasi. Kami segera memprosesnya untukmu 💧',
  [NotificationEvent.ORDER_CONFIRMED]:
    'Halo {{name}}! Pesanan {{orderNumber}} sudah kami konfirmasi dan sedang kami siapkan. Terima kasih sudah memesan di Hydromart 💧',
  [NotificationEvent.ORDER_ON_DELIVERY]:
    'Kabar baik, {{name}}! Pesanan {{orderNumber}} sedang dalam perjalanan ke alamatmu. Mohon siapkan galon kosong bila ada penukaran ya.',
  [NotificationEvent.ORDER_DELIVERED]:
    'Pesanan {{orderNumber}} sudah sampai. Selamat menikmati air bersih dari Hydromart, {{name}}! 💧',
  [NotificationEvent.ORDER_COMPLETED]:
    'Terima kasih, {{name}}! Pesanan {{orderNumber}} selesai. Poin loyalti kamu sudah ditambahkan — cek saldo poin di aplikasi.',
  [NotificationEvent.ORDER_CANCELLED]:
    'Halo {{name}}, pesanan {{orderNumber}} telah dibatalkan. Bila sudah ada pembayaran, dana dikembalikan sesuai metode pembayaranmu. Hubungi kami bila butuh bantuan.',
  [NotificationEvent.STOCK_LOW]:
    '⚠️ Stok menipis di depot {{depot}}: {{item}} tinggal {{quantity}} (minimum {{minimum}}). Segera lakukan pengisian ulang.',
  [NotificationEvent.COURIER_INCIDENT]:
    '🚨 Insiden {{severity}} dilaporkan kurir — {{category}}: {{note}}. Mohon segera ditindaklanjuti.',
  [NotificationEvent.CUSTOMER_REGISTERED]:
    'Selamat datang di Hydromart, {{name}}! 💧 Akunmu sudah aktif. Pesan air bersih kapan saja lewat aplikasi kami. Terima kasih sudah bergabung!',
  [NotificationEvent.POINTS_EARNED]:
    'Mantap, {{name}}! Kamu dapat +{{points}} poin dari pesanan {{orderNumber}}. Kumpulkan poin untuk tukar voucher & naik tier di aplikasi.',
  [NotificationEvent.VOUCHER_GRANTED]:
    'Ada voucher baru untukmu, {{name}}! Kode {{code}} — {{description}}. Pakai saat checkout sebelum masa berlaku habis 🎟️',
  [NotificationEvent.REORDER_REMINDER]:
    'Halo {{name}}, galonmu mungkin sudah menipis. Pesan ulang sekarang, diantar cepat dari depot terdekat 💧',
};

// Operational (staff-facing) events surfaced in the ops notification center (PRD 10d),
// as opposed to the customer inbox. STOCK_LOW is the operational alert today; add more
// staff-targeted events here as they are introduced.
export const OPS_EVENTS: NotificationEvent[] = [
  NotificationEvent.STOCK_LOW,
  NotificationEvent.COURIER_INCIDENT,
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
