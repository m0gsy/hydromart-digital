import { NotificationEvent } from './notification-event';

/**
 * HD-12: the first wave of what number 1 sends. UTILITY only, customer events only, one template each. A
 * template is only ever sent through its spec, so it cannot go out with the parameters in the wrong order.
 *
 * Left out on purpose: ORDER_RECEIVED (duplicates CONFIRMED, saves cost), PAYMENT_REMINDER (UNPAID_ORDER covers
 * it), POINTS_*, MEMBERSHIP_TIER_UPGRADED, VOUCHER_*, REORDER_REMINDER, REVIEW_REQUEST (promotional in Meta's
 * eyes: HD-24, MARKETING), GALLON_RETURN_REMINDER (second wave), PHONE_CHANGED (goes to the OLD number, which has
 * no consent), OTP (SMS) and every staff or ops event (bell, push, email).
 */
export interface WaTemplateSpec {
  /** Meta template name: lowercase and underscores only. */
  name: string;
  language: 'id';
  category: 'UTILITY';
  /** Exact text to submit in Meta Manager; `{{n}}` are the positional parameters. One line, no emoji. */
  body: string;
  /** The notification variable behind each `{{n}}`, in order. */
  params: readonly string[];
}

export const WA_TEMPLATE_SPECS = {
  [NotificationEvent.ORDER_CONFIRMED]: {
    name: 'hm_order_confirmed',
    language: 'id',
    category: 'UTILITY',
    body: 'Halo {{1}}! Pesanan {{2}} sudah kami konfirmasi dan sedang kami siapkan. Terima kasih sudah memesan di Hydromart.',
    params: ['name', 'orderNumber'],
  },
  [NotificationEvent.ORDER_DRIVER_ASSIGNED]: {
    name: 'hm_order_driver_assigned',
    language: 'id',
    category: 'UTILITY',
    body: 'Halo {{1}}! Pesanan {{2}} sudah diambil kurir kami dan segera berangkat. Mulai sekarang pesanan tidak bisa dibatalkan sendiri lewat aplikasi, hubungi depot bila ada perubahan.',
    params: ['name', 'orderNumber'],
  },
  [NotificationEvent.ORDER_ON_DELIVERY]: {
    name: 'hm_order_on_delivery',
    language: 'id',
    category: 'UTILITY',
    body: 'Kabar baik, {{1}}! Pesanan {{2}} sedang dalam perjalanan ke alamatmu. Mohon siapkan galon kosong bila ada penukaran ya.',
    params: ['name', 'orderNumber'],
  },
  [NotificationEvent.ORDER_DELIVERED]: {
    name: 'hm_order_delivered',
    language: 'id',
    category: 'UTILITY',
    body: 'Pesanan {{1}} sudah sampai. Selamat menikmati air bersih dari Hydromart, {{2}}!',
    params: ['orderNumber', 'name'],
  },
  [NotificationEvent.ORDER_CANCELLED]: {
    name: 'hm_order_cancelled',
    language: 'id',
    category: 'UTILITY',
    body: 'Halo {{1}}, pesanan {{2}} telah dibatalkan. Bila sudah ada pembayaran, dana dikembalikan sesuai metode pembayaranmu. Hubungi kami bila butuh bantuan.',
    params: ['name', 'orderNumber'],
  },
  [NotificationEvent.PAYMENT_FAILED]: {
    name: 'hm_payment_failed',
    language: 'id',
    category: 'UTILITY',
    body: 'Halo {{1}}, pembayaran pesanan {{2}} belum berhasil ({{3}}). Silakan bayar ulang dari aplikasi.',
    params: ['name', 'orderNumber', 'reason'],
  },
  [NotificationEvent.REFUND_PROCESSED]: {
    name: 'hm_refund_processed',
    language: 'id',
    category: 'UTILITY',
    body: 'Halo {{1}}, refund {{2}} untuk pesanan {{3}} sudah diproses. Dana kembali lewat metode pembayaranmu.',
    params: ['name', 'amount', 'orderNumber'],
  },
  [NotificationEvent.DELIVERY_RESCHEDULED]: {
    name: 'hm_delivery_rescheduled',
    language: 'id',
    category: 'UTILITY',
    body: 'Halo, pengiriman pesanan {{1}} dijadwalkan ulang ke {{2}} {{3}}. {{4}} Mohon maaf atas ketidaknyamanannya.',
    params: ['orderNumber', 'rescheduledFor', 'slot', 'note'],
  },
  [NotificationEvent.SUBSCRIPTION_TOMORROW]: {
    name: 'hm_subscription_tomorrow',
    language: 'id',
    category: 'UTILITY',
    body: 'Pengingat: langganan {{1}} ({{2}}) dijadwalkan diantar besok, {{3}}. Pastikan ada yang menerima ya.',
    params: ['product', 'quantity', 'date'],
  },
  [NotificationEvent.UNPAID_ORDER]: {
    name: 'hm_unpaid_order',
    language: 'id',
    category: 'UTILITY',
    body: 'Pesanan {{1}} ({{2}}) masih menunggu pembayaran. Selesaikan sekarang, pesanan yang belum dibayar dibatalkan otomatis.',
    params: ['orderNumber', 'amount'],
  },
} as const satisfies Partial<Record<NotificationEvent, WaTemplateSpec>>;

export type WaUtilityEvent = keyof typeof WA_TEMPLATE_SPECS;

/** The events number 1 may send. The one list the send path and the template list share. */
export const WA_UTILITY_EVENTS = Object.keys(WA_TEMPLATE_SPECS) as WaUtilityEvent[];

export function isWaUtilityEvent(event: string): event is WaUtilityEvent {
  return (WA_UTILITY_EVENTS as string[]).includes(event);
}
