// Transactional WhatsApp notifications (PRD §19 Notification Matrix, FR-093/FR-094).
// Unlike broadcast campaigns (staff-authored, bulk), these are event-triggered, single
// recipient, and automated: upstream services (order-service) fire them on lifecycle
// changes. The message copy lives here (marketing-owned) rather than being scattered
// across the emitting services; callers pass only the event and template variables.

export enum NotificationEvent {
  ORDER_CONFIRMED = 'ORDER_CONFIRMED',
  ORDER_ON_DELIVERY = 'ORDER_ON_DELIVERY',
  ORDER_DELIVERED = 'ORDER_DELIVERED',
  ORDER_COMPLETED = 'ORDER_COMPLETED',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
}

// WhatsApp message templates (Bahasa Indonesia). Tokens: {{name}}, {{orderNumber}}.
export const NOTIFICATION_TEMPLATES: Record<NotificationEvent, string> = {
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
};

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
