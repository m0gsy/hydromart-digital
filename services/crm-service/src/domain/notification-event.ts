import type { Capability } from '@hydromart/access';

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
  /**
   * FR-052: a customer moved an order's delivery slot — addressed to the DEPOT, which had planned
   * its day around the old one.
   */
  DEPOT_ORDER_RESCHEDULED = 'DEPOT_ORDER_RESCHEDULED',
  /**
   * 2026-11-20: the customer moved an order to another address (same depot, before it was
   * prepared) — addressed to the DEPOT, which may have printed the old one already.
   * Tokens: {{orderNumber}}, {{orderId}}, {{address}}.
   */
  DEPOT_ORDER_ADDRESS_CHANGED = 'DEPOT_ORDER_ADDRESS_CHANGED',
  /**
   * The customer cancelled their own order — addressed to the DEPOT. The customer's own
   * cancel is silent by design (they just did it), which left the depot preparing an order
   * that no longer existed. Tokens: {{orderNumber}}, {{orderId}}, {{total}}.
   */
  DEPOT_ORDER_CANCELLED = 'DEPOT_ORDER_CANCELLED',
  // Payment, customer-facing. A paid payment needs no event of its own: ORDER_CONFIRMED is
  // sent the moment it settles, and a second message for the same instant would only be noise.
  // Tokens: {{name}}, {{orderNumber}}, {{orderId}}; PAYMENT_FAILED adds {{reason}},
  // PAYMENT_REMINDER and REFUND_PROCESSED add {{amount}}.
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  PAYMENT_REMINDER = 'PAYMENT_REMINDER',
  REFUND_PROCESSED = 'REFUND_PROCESSED',
  // To the DEPOT: a customer uploaded a transfer receipt that is waiting to be verified.
  // Tokens: {{orderNumber}}, {{orderId}}, {{amount}}.
  DEPOT_PAYMENT_PROOF = 'DEPOT_PAYMENT_PROOF',
  // To the DEPOT: money arrived for an order that is still unconfirmed half an hour later -
  // the settle-then-confirm hand-off between payment and order service dropped it.
  // Tokens: {{orderNumber}}, {{orderId}}, {{amount}}.
  DEPOT_PAYMENT_UNCONFIRMED = 'DEPOT_PAYMENT_UNCONFIRMED',
  // To the manager at the top of the depot's supervision chain: an item is waiting for a
  // decision. Tokens: {{title}}, {{depot}}, {{amount}}, {{approvalId}}.
  APPROVAL_REQUESTED = 'APPROVAL_REQUESTED',
  // Flow 6b (plan PR-6): to the accounts that may decide it (APPROVER_CAP_FOR_EVENT).
  // A courier handed in the shift's cash. Tokens: {{amount}}, {{variance}}, {{settlementId}}.
  COURIER_SETTLEMENT_SUBMITTED = 'COURIER_SETTLEMENT_SUBMITTED',
  // A depot proposed a price change. Tokens: {{depot}}, {{count}}, {{product}}.
  PRICE_OVERRIDE_PROPOSED = 'PRICE_OVERRIDE_PROPOSED',
  // A courier's expense claim waits for a reviewer. Tokens: {{amount}}, {{category}}, {{claimId}}.
  EXPENSE_CLAIM_SUBMITTED = 'EXPENSE_CLAIM_SUBMITTED',
  // A refund above the HQ threshold waits in the refund queue. Tokens: {{amount}}, {{paymentId}}.
  REFUND_REQUESTED = 'REFUND_REQUESTED',
  // AI-5: a calon mitra applied on /waralaba. Raised by n8n (machine token) through
  // POST notifications/external/franchise-application-submitted, never by a service.
  // Tokens: {{city}}, {{province}}; `applicationId` rides along for the tap.
  FRANCHISE_APPLICATION_SUBMITTED = 'FRANCHISE_APPLICATION_SUBMITTED',
  // AI-9: the Direksi morning summary, one row per recipient, raised by
  // POST notifications/external/morning-summary (n8n only triggers it). Tokens: {{summary}}
  // (queue labels with their counts), {{oldest}} (" Tertua sejak 12 Nov." or empty), `href`
  // rides along for the tap. Counts only, nothing personal.
  MORNING_SUMMARY = 'MORNING_SUMMARY',
  // AI-7c: someone in the AI web asked for access to data their role may not read. One row per
  // person who can grant it (legalEntityAiAccess), raised by POST notifications/external/
  // ai-access-requested. Tokens: {{who}} (name and role), {{what}} (entities or data group).
  AI_ACCESS_REQUESTED = 'AI_ACCESS_REQUESTED',
  // HD-18, customer reminders n8n triggers (POST notifications/external/customer-reminders).
  // Tokens: {{product}}, {{quantity}}, {{date}} (the delivery day, "26 Nov").
  SUBSCRIPTION_TOMORROW = 'SUBSCRIPTION_TOMORROW',
  // Tokens: {{points}}, {{expires}} (the day the lot lapses, "30 Nov").
  POINTS_EXPIRING = 'POINTS_EXPIRING',
  // Tokens: {{orderNumber}}, {{orderId}} (the tap opens the order), {{amount}}.
  UNPAID_ORDER = 'UNPAID_ORDER',
  // HD-15: a piece of depot equipment (filter, UV lamp, RO membrane...) is due for service by days
  // or by water volume. One row per recipient (the depot's Kepala, the supervisors over it, HQ
  // Operasional), raised by POST notifications/external/maintenance-due. Tokens: {{depot}},
  // {{items}} (the due items with the reason each; for HQ the count per depot).
  MAINTENANCE_DUE = 'MAINTENANCE_DUE',
  // HD-14: a depot permit is within 30 days of expiry (or expired) / a required lab test is overdue.
  // Same audience and shape as MAINTENANCE_DUE, raised by POST notifications/external/compliance-due.
  // Tokens: {{depot}}, {{items}}, {{depotId}} (the tap).
  PERMIT_DUE = 'PERMIT_DUE',
  LAB_TEST_DUE = 'LAB_TEST_DUE',
  // HD-14: a depot's quality hold began or ended. Staff only, never customers; raised by POST
  // notifications/external/quality-hold. Token: {{text}} (the whole sentence, built in QualityHoldNoticeService).
  QUALITY_HOLD = 'QUALITY_HOLD',
  // AI-26: the weekly Sales report of one legal entity is ready in the AI web. One row per person who
  // may read that entity's calon mitra CRM, raised by POST notifications/external/sales-weekly-ready.
  // Tokens: {{week}} ("23 Nov - 29 Nov"), {{entity}}, {{link}} (the AI web page, the AI web page).
  SALES_WEEKLY_REPORT = 'SALES_WEEKLY_REPORT',
  // AI-31: an AI agent of the "Tim AI" flagged something new, reached its monthly cap, or was
  // stopped (one agent, or all). One row per person who manages the AI team and per boss role,
  // raised by POST notifications/external/ai-agent-notice. Tokens: {{who}}, {{link}}.
  AI_AGENT_FLAG = 'AI_AGENT_FLAG',
  AI_AGENT_CAP = 'AI_AGENT_CAP',
  AI_AGENT_STOPPED = 'AI_AGENT_STOPPED',
  // AI-14: a calon mitra filled the public form on the AI web (NEW), or the lead waited past 2 / 4
  // working hours (REMIND / ESCALATE). One row per Sales person, raised by POST
  // notifications/external/ai-lead-notice. Tokens: {{city}}, {{province}}, {{link}}.
  AI_LEAD_NEW = 'AI_LEAD_NEW',
  AI_LEAD_REMIND = 'AI_LEAD_REMIND',
  AI_LEAD_ESCALATE = 'AI_LEAD_ESCALATE',
  // HD-15B: a completed supervisor visit with findings (one digest per recipient per visit), and the
  // open follow-ups past their deadline (one digest per recipient per depot per day). Raised by
  // POST notifications/internal/visit-notice from depot-service. Tokens: {{depot}}, {{items}},
  // {{visitId}} / {{depotId}} (the tap).
  VISIT_FINDING = 'VISIT_FINDING',
  FOLLOW_UP_OVERDUE = 'FOLLOW_UP_OVERDUE',
  // HD-23: the monthly royalty bill, sent to each franchise owner whose depots it covers. Raised by
  // POST notifications/internal/partner-bill from payout-service when Finance approves it. Tokens:
  // {{month}}, {{entity}}, {{total}}, {{bank}}, {{number}}, {{holder}}.
  PARTNER_BILL = 'PARTNER_BILL',
  // HD-23: a sent bill was withdrawn; the owners it went to are told why. Tokens: {{month}}, {{reason}}.
  PARTNER_BILL_VOID = 'PARTNER_BILL_VOID',
  // HD-12: WhatsApp number 1 passed 80% of a monthly cap / reached it. One row for the accounts holding
  // waCostRead (raised inside crm, not by n8n). Tokens: {{category}}, {{pct}}, {{used}}, {{cap}}.
  WA_CAP_WARNING = 'WA_CAP_WARNING',
  WA_CAP_REACHED = 'WA_CAP_REACHED',
  ORDER_CONFIRMED = 'ORDER_CONFIRMED',
  ORDER_ON_DELIVERY = 'ORDER_ON_DELIVERY',
  ORDER_DELIVERED = 'ORDER_DELIVERED',
  ORDER_COMPLETED = 'ORDER_COMPLETED',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
  // B6: the one transition where silence costs the customer something. BR-006 ends their
  // right to cancel the moment a courier is assigned, and nothing told them — the button
  // simply stopped being there. Tokens: {{name}}, {{orderNumber}}, {{driver}}.
  ORDER_DRIVER_ASSIGNED = 'ORDER_DRIVER_ASSIGNED',
  /**
   * A delivery was assigned to a courier — addressed to that courier's own account. The
   * customer is told by ORDER_DRIVER_ASSIGNED; the courier was told nothing and had to open
   * the app to find out. Tokens: {{orderNumber}}, {{deliveryId}}.
   */
  COURIER_DELIVERY_ASSIGNED = 'COURIER_DELIVERY_ASSIGNED',
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
  // Operational (not customer-facing): fired twice a day by order-service's cron (13:00 and
  // 21:00 WIB) with the day so far — the same figures the depot's daily report screen shows.
  // Tokens: {{slot}}, {{depot}}, {{gallons}}, {{orders}}, {{revenue}}, {{counterCash}},
  // {{cod}}; the two cash tokens read "—" when payment-service could not be reached, never
  // a fabricated zero. Recipient is the depot's own number, falling back to the ops number.
  DEPOT_SALES_UPDATE = 'DEPOT_SALES_UPDATE',
  // Account: fired by auth-service (via internal service auth) when a new customer
  // completes phone verification. Token: {{name}}.
  CUSTOMER_REGISTERED = 'CUSTOMER_REGISTERED',
  // K1.4, security. Fired by auth-service AFTER a phone number change succeeds, and sent
  // to the OLD number — the one that has just stopped being the login identity. It is the
  // only warning a stolen phone change produces: nothing else about one is visible to the
  // person losing the account. Tokens: {{name}}, {{newPhone}} (masked).
  PHONE_CHANGED = 'PHONE_CHANGED',
  // Loyalty: fired by order-service on completion. Tokens: {{name}}, {{points}}, {{orderNumber}}.
  POINTS_EARNED = 'POINTS_EARNED',
  // Loyalty: fired by order-service right after POINTS_EARNED when that earn lifted the customer
  // into a higher tier (loyalty-service reports it). Tokens: {{name}}, {{tier}} ("Silver").
  // It deliberately quotes no discount rate: the rate a customer gets is re-derived against the
  // ladder of the depot they order from, so a number here could be wrong at some depots.
  MEMBERSHIP_TIER_UPGRADED = 'MEMBERSHIP_TIER_UPGRADED',
  // Rewards/referral: fired when a voucher is granted. Tokens: {{name}}, {{code}}, {{description}}.
  VOUCHER_GRANTED = 'VOUCHER_GRANTED',
  // A voucher in the customer's wallet lapses in about three days. Tokens: {{name}}, {{code}}, {{expires}}.
  VOUCHER_EXPIRING = 'VOUCHER_EXPIRING',
  // K4.2, agen-facing. What a reseller pays used to change with no trail, no date and no
  // message — they found out at the till, arguing with a cashier who was reading the
  // correct new price. Fired by customer-service on an immediate change AND by its
  // scheduled-change sweep. Tokens: {{name}}, {{terms}}.
  RESELLER_PRICE_CHANGED = 'RESELLER_PRICE_CHANGED',
  // The same moment, but the answer is "you are no longer an agen" — a deactivation reads
  // nothing like a new rate and must not be dressed as one. Tokens: {{name}}.
  RESELLER_DEACTIVATED = 'RESELLER_DEACTIVATED',
  // D2, and the SECOND time this exact defect shipped. order-service has been emitting
  // 'SUBSCRIPTION_PAUSED' since the failure-counter landed — a standing order that stopped
  // arriving after three consecutive failures — and it was never a member here. So `@IsEnum`
  // answered 400, the sending adapter turned the refusal into a `logger.warn` and returned
  // false, and the caller's `.catch(() => false)` swallowed that. The pause was durable; the
  // only thing the customer would have noticed was water that stopped coming.
  //
  // Read the B4 comment fifty lines up: same failure, same two services, same silence. That
  // is why this PR also adds scripts/check-notification-events.mjs — a comment did not stop
  // it happening twice.
  // Tokens: {{name}}, {{product}}, {{reason}}.
  SUBSCRIPTION_PAUSED = 'SUBSCRIPTION_PAUSED',
  // Retention nudge: "time to refill". Token: {{name}}.
  REORDER_REMINDER = 'REORDER_REMINDER',
  // Fired daily by depot-service's reminder sweep for a customer still holding gallons past the
  // depot's loan limit. A service message about something the customer holds on deposit, not
  // a promotion — so it is NOT gated by the marketing opt-out. Tokens: {{name}}, {{depot}},
  // {{gallons}} (how many are overdue), {{since}} (when the oldest went out, e.g. "12 Ags 2026").
  GALLON_RETURN_REMINDER = 'GALLON_RETURN_REMINDER',
  // Fired by order-service's review sweep some time after a delivery arrived: "how was it?".
  // Opens the order, where the rating form is. A service message about a purchase the customer
  // made, not a promotion. Tokens: {{name}}, {{orderNumber}}; `orderId` rides along for the tap.
  REVIEW_REQUEST = 'REVIEW_REQUEST',
  // HR (hr-service, internal key). Staff-facing, never customers. Leave events carry
  // {{name}}, {{type}}, {{from}}, {{to}}; a rejection adds {{reason}}. HR_ANNOUNCEMENT
  // carries {{title}} and {{body}}.
  LEAVE_SUBMITTED = 'LEAVE_SUBMITTED',
  LEAVE_APPROVED = 'LEAVE_APPROVED',
  LEAVE_REJECTED = 'LEAVE_REJECTED',
  LOAN_REQUEST_SUBMITTED = 'LOAN_REQUEST_SUBMITTED',
  LOAN_REQUEST_APPROVED = 'LOAN_REQUEST_APPROVED',
  LOAN_REQUEST_REJECTED = 'LOAN_REQUEST_REJECTED',
  HR_ANNOUNCEMENT = 'HR_ANNOUNCEMENT',
  // To the employee only: their payslip for a month is available. Tokens: {{name}}, {{period}}.
  // To the employee only: their rota shift starts soon. Tokens: {{name}}, {{time}}.
  SHIFT_REMINDER = 'SHIFT_REMINDER',
  PAYSLIP_READY = 'PAYSLIP_READY',
  // To the employee only: their check-in was recorded late. Tokens: {{name}}, {{minutes}}, {{date}}.
  ATTENDANCE_LATE = 'ATTENDANCE_LATE',
  // Marketing broadcast (Module 12). The one event whose copy is NOT owned here: staff
  // author the whole message in the HQ broadcast console, so the template is a bare
  // passthrough. It still goes through the same path as every other notification — an
  // inbox row plus best-effort push — which is exactly why it is an event at all.
  BROADCAST = 'BROADCAST',
}

/**
 * K5.3: which language a message is written in.
 *
 * Not the app's locale — that one lives in a browser's localStorage and the sender has no
 * browser. This is the copy customer-service stores on the customer's notification row, and
 * it is the only thing that tells a server-rendered WhatsApp or push which table to read.
 */
export type MessageLocale = 'id' | 'en';

// Message templates. Tokens: {{name}}, {{orderNumber}} for order events; {{depot}},
// {{item}}, {{quantity}}, {{minimum}} for STOCK_LOW.
//
// Both tables are a FULL `Record<NotificationEvent, string>` on purpose: a new event breaks
// the build until it has been written in both languages. A `Partial` with a fallback would
// compile, and the first customer reading English would get one Indonesian message nobody
// noticed. Writing every template twice is the price of that; it was accepted knowingly.
const TEMPLATES_ID: Record<NotificationEvent, string> = {
  [NotificationEvent.ORDER_RECEIVED]:
    'Halo {{name}}! Pesanan {{orderNumber}} sudah kami terima dan sedang menunggu konfirmasi. Kami segera memprosesnya untukmu 💧',
  [NotificationEvent.DEPOT_ORDER_INCOMING]:
    'Pesanan baru masuk: {{orderNumber}} · {{total}}. Buka antrean untuk memprosesnya.',
  [NotificationEvent.DEPOT_ORDER_RESCHEDULED]:
    'Jadwal pesanan {{orderNumber}} diubah pelanggan ke {{when}}. Cek antrean untuk menyesuaikan.',
  [NotificationEvent.DEPOT_ORDER_ADDRESS_CHANGED]:
    'Alamat pesanan {{orderNumber}} diubah pelanggan ke {{address}}. Pakai alamat baru ini, bukan yang tercetak.',
  [NotificationEvent.APPROVAL_REQUESTED]:
    'Menunggu persetujuan Anda: {{title}} ({{depot}}, {{amount}}). Buka menu Persetujuan untuk memutuskan.',
  [NotificationEvent.COURIER_SETTLEMENT_SUBMITTED]:
    'Setoran kurir {{amount}} menunggu verifikasi (selisih {{variance}}). Buka menu Setoran untuk memeriksa.',
  [NotificationEvent.PRICE_OVERRIDE_PROPOSED]:
    '{{depot}} mengusulkan {{count}} perubahan harga ({{product}}). Buka menu Harga untuk memutuskan.',
  [NotificationEvent.EXPENSE_CLAIM_SUBMITTED]:
    'Klaim biaya kurir {{amount}} ({{category}}) menunggu persetujuan. Buka menu Klaim biaya untuk memutuskan.',
  [NotificationEvent.REFUND_REQUESTED]:
    'Refund {{amount}} menunggu persetujuan pusat. Buka antrean Refund untuk memutuskan.',
  // "Lamaran waralaba" is the HQ menu label of that screen (hq.nav.applications).
  [NotificationEvent.FRANCHISE_APPLICATION_SUBMITTED]:
    'Lamaran waralaba baru dari calon mitra di {{city}}, {{province}}. Buka menu Lamaran waralaba untuk meninjau.',
  [NotificationEvent.MORNING_SUMMARY]: 'Persetujuan yang menunggu Anda: {{summary}}.{{oldest}}',
  [NotificationEvent.AI_ACCESS_REQUESTED]:
    '{{who}} meminta akses AI web untuk {{what}}. Buka Badan hukum, bagian akses AI, untuk memberikannya.',
  [NotificationEvent.SUBSCRIPTION_TOMORROW]:
    'Pengingat: langganan {{product}} ({{quantity}}) dijadwalkan diantar besok, {{date}}. Pastikan ada yang menerima ya 💧',
  [NotificationEvent.POINTS_EXPIRING]:
    '{{points}} poinmu akan hangus pada {{expires}}. Tukarkan dengan voucher di halaman Rewards sebelum hangus ⭐',
  [NotificationEvent.UNPAID_ORDER]:
    'Pesanan {{orderNumber}} ({{amount}}) masih menunggu pembayaran. Selesaikan sekarang, pesanan yang belum dibayar dibatalkan otomatis.',
  [NotificationEvent.SALES_WEEKLY_REPORT]:
    'Minggu {{week}}: buka laporan calon mitra untuk {{entity}}. {{link}}',
  [NotificationEvent.AI_AGENT_FLAG]: '{{who}} menandai kejanggalan baru. Buka Tim AI untuk detail. {{link}}',
  [NotificationEvent.AI_AGENT_CAP]: '{{who}} berhenti: plafon bulan ini tercapai. Buka Tim AI untuk detail. {{link}}',
  [NotificationEvent.AI_AGENT_STOPPED]: '{{who}} dihentikan. Buka Tim AI untuk detail. {{link}}',
  [NotificationEvent.AI_LEAD_NEW]:
    'Calon mitra baru dari formulir di {{city}}, {{province}}. Buka antrean dan ambil dalam 2 jam kerja. {{link}}',
  [NotificationEvent.AI_LEAD_REMIND]: 'Calon mitra dari {{city}} belum dihubungi lewat 2 jam kerja. {{link}}',
  [NotificationEvent.AI_LEAD_ESCALATE]:
    'Calon mitra dari {{city}} belum dihubungi lewat 4 jam kerja. Perlu tindakan Sales Lead. {{link}}',
  [NotificationEvent.WA_CAP_WARNING]:
    'WhatsApp nomor 1: {{category}} sudah {{pct}}% dari batas bulan ini ({{used}}/{{cap}}).',
  [NotificationEvent.WA_CAP_REACHED]:
    'WhatsApp nomor 1: batas {{category}} bulan ini tercapai. Pengiriman WhatsApp berhenti; notifikasi aplikasi tetap jalan.',
  [NotificationEvent.MAINTENANCE_DUE]:
    'Perawatan jatuh tempo di {{depot}}: {{items}}. Buka menu Perawatan untuk menjadwalkan servis.',
  [NotificationEvent.PERMIT_DUE]:
    'Izin depot {{depot}} perlu diperbarui: {{items}}. Buka menu Uji lab dan izin untuk mencatat izin yang baru.',
  [NotificationEvent.LAB_TEST_DUE]:
    'Uji lab depot {{depot}} jatuh tempo: {{items}}. Lakukan ujinya dan catat hasilnya di menu Uji lab dan izin.',
  [NotificationEvent.QUALITY_HOLD]: '{{text}}',
  [NotificationEvent.VISIT_FINDING]:
    'Kunjungan supervisor ke {{depot}} menemukan: {{items}}. Buka kunjungan untuk melihat dan menindaklanjutinya.',
  [NotificationEvent.FOLLOW_UP_OVERDUE]:
    'Tindak lanjut kunjungan di {{depot}} terlambat: {{items}}. Buka menu Kunjungan untuk menyelesaikannya.',
  [NotificationEvent.PARTNER_BILL]:
    'Tagihan royalti {{month}} untuk {{entity}}: {{total}}. Transfer ke {{bank}} {{number}} a.n. {{holder}}. Rincian di aplikasi.',
  [NotificationEvent.PARTNER_BILL_VOID]:
    'Tagihan royalti {{month}} dibatalkan: {{reason}}. Tagihan pengganti akan dikirim bila ada.',
  [NotificationEvent.PAYMENT_FAILED]:
    'Halo {{name}}, pembayaran pesanan {{orderNumber}} belum berhasil ({{reason}}). Silakan bayar ulang dari aplikasi.',
  [NotificationEvent.PAYMENT_REMINDER]:
    'Halo {{name}}, pesanan {{orderNumber}} masih menunggu pembayaran {{amount}}. Selesaikan pembayaran agar pesanan segera diproses.',
  [NotificationEvent.REFUND_PROCESSED]:
    'Halo {{name}}, refund {{amount}} untuk pesanan {{orderNumber}} sudah diproses. Dana kembali lewat metode pembayaranmu.',
  [NotificationEvent.DEPOT_PAYMENT_UNCONFIRMED]:
    'Pembayaran {{amount}} untuk pesanan {{orderNumber}} sudah lunas tetapi pesanan belum dikonfirmasi. Buka pesanan dan konfirmasi manual.',
  [NotificationEvent.DEPOT_PAYMENT_PROOF]:
    'Bukti pembayaran masuk untuk pesanan {{orderNumber}} ({{amount}}). Buka pesanan untuk memeriksa bukti dan mengonfirmasi lunas.',
  [NotificationEvent.DEPOT_ORDER_CANCELLED]:
    'Pesanan {{orderNumber}} ({{total}}) dibatalkan oleh pelanggan. Stok dikembalikan; tidak perlu diproses lagi.',
  [NotificationEvent.COURIER_DELIVERY_ASSIGNED]:
    'Pengiriman baru untukmu: pesanan {{orderNumber}}. Buka aplikasi untuk alamat dan detailnya.',
  [NotificationEvent.SHIFT_REMINDER]:
    'Halo {{name}}, shift Anda mulai pukul {{time}}. Jangan lupa absen masuk.',
  [NotificationEvent.PAYSLIP_READY]:
    'Halo {{name}}, slip gaji {{period}} sudah tersedia. Buka menu Gaji saya untuk melihatnya.',
  [NotificationEvent.ATTENDANCE_LATE]:
    'Halo {{name}}, absen masuk Anda pada {{date}} tercatat terlambat {{minutes}} menit.',
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
    'Laporan penjualan {{slot}} depot {{depot}}: {{gallons}} galon, {{orders}} pesanan, omzet {{revenue}}. Kas konter {{counterCash}}, COD {{cod}}.',
  [NotificationEvent.CUSTOMER_REGISTERED]:
    'Selamat datang di Hydromart, {{name}}! 💧 Akunmu sudah aktif. Pesan air bersih kapan saja lewat aplikasi kami. Terima kasih sudah bergabung!',
  [NotificationEvent.PHONE_CHANGED]:
    'Halo {{name}}, nomor akun Hydromart kamu baru saja diganti ke {{newPhone}}. Mulai sekarang kode masuk dikirim ke nomor itu. Bukan kamu yang melakukannya? Segera hubungi depot.',
  [NotificationEvent.POINTS_EARNED]:
    'Mantap, {{name}}! Kamu dapat +{{points}} poin dari pesanan {{orderNumber}}. Kumpulkan poin untuk tukar voucher & naik tier di aplikasi.',
  [NotificationEvent.VOUCHER_GRANTED]:
    'Ada voucher baru untukmu, {{name}}! Kode {{code}} — {{description}}. Pakai saat checkout sebelum masa berlaku habis 🎟️',
  [NotificationEvent.VOUCHER_EXPIRING]:
    'Halo {{name}}, voucher {{code}} berakhir {{expires}}. Pakai sebelum hangus 🎟️',
  [NotificationEvent.RESELLER_PRICE_CHANGED]:
    'Halo {{name}}, harga agen kamu diperbarui: {{terms}}. Berlaku mulai sekarang — cek detailnya di aplikasi sebelum belanja berikutnya.',
  [NotificationEvent.RESELLER_DEACTIVATED]:
    'Halo {{name}}, status agen kamu dinonaktifkan, jadi pembelian berikutnya memakai harga umum. Hubungi depot bila ini tidak sesuai.',
  [NotificationEvent.SUBSCRIPTION_PAUSED]:
    'Halo {{name}}! Langganan {{product}} kami jeda dulu karena {{reason}}. Tidak ada tagihan selama dijeda — buka Langganan untuk melanjutkan kapan saja.',
  [NotificationEvent.MEMBERSHIP_TIER_UPGRADED]:
    'Selamat, {{name}}! Kamu naik ke tier {{tier}} 🎉 Lihat keuntungan tier barumu di halaman Rewards.',
  [NotificationEvent.REORDER_REMINDER]:
    'Halo {{name}}, galonmu mungkin sudah menipis. Pesan ulang sekarang, diantar cepat dari depot terdekat 💧',
  [NotificationEvent.GALLON_RETURN_REMINDER]:
    'Halo {{name}}, kamu masih memegang {{gallons}} galon milik depot {{depot}} sejak {{since}}. Kalau sudah tidak dipakai, mohon dikembalikan ya — deposit galonnya bisa kamu terima kembali.',
  [NotificationEvent.REVIEW_REQUEST]:
    'Halo {{name}}, pesanan {{orderNumber}} sudah sampai. Bagaimana kesannya? Beri penilaian sebentar — masukanmu membantu depot memperbaiki layanan ⭐',
  [NotificationEvent.LEAVE_SUBMITTED]:
    'Pengajuan cuti {{type}} dari {{name}} ({{from}} s/d {{to}}) menunggu persetujuan Anda.',
  [NotificationEvent.LEAVE_APPROVED]:
    'Halo {{name}}, cuti {{type}} tanggal {{from}} s/d {{to}} sudah DISETUJUI. Selamat beristirahat!',
  [NotificationEvent.LEAVE_REJECTED]:
    'Halo {{name}}, cuti {{type}} tanggal {{from}} s/d {{to}} DITOLAK. Alasan: {{reason}}. Silakan hubungi HR bila perlu.',
  [NotificationEvent.LOAN_REQUEST_SUBMITTED]:
    'Pengajuan kasbon dari {{name}} sebesar Rp{{amount}} menunggu keputusan Anda.',
  [NotificationEvent.LOAN_REQUEST_APPROVED]:
    'Halo {{name}}, kasbon Rp{{amount}} DISETUJUI. Cicilannya dipotong otomatis dari gaji — lihat rinciannya di menu Kasbon.',
  [NotificationEvent.LOAN_REQUEST_REJECTED]:
    'Halo {{name}}, kasbon Rp{{amount}} DITOLAK. Alasan: {{reason}}. Silakan hubungi atasan Anda bila perlu.',
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
  NotificationEvent.DEPOT_ORDER_RESCHEDULED,
  NotificationEvent.DEPOT_ORDER_ADDRESS_CHANGED,
  NotificationEvent.DEPOT_ORDER_CANCELLED,
  NotificationEvent.DEPOT_PAYMENT_PROOF,
  NotificationEvent.DEPOT_PAYMENT_UNCONFIRMED,
  // Addressed to one courier's account, so it is also in PERSONAL_OPS_EVENTS below.
  NotificationEvent.COURIER_DELIVERY_ASSIGNED,
  NotificationEvent.APPROVAL_REQUESTED,
  // Flow 6b: in the depot's feed (and head office's) like any depot alert; the PUSH goes to
  // the accounts that may decide it only (APPROVER_CAP_FOR_EVENT).
  NotificationEvent.COURIER_SETTLEMENT_SUBMITTED,
  NotificationEvent.PRICE_OVERRIDE_PROPOSED,
  NotificationEvent.EXPENSE_CLAIM_SUBMITTED,
  NotificationEvent.REFUND_REQUESTED,
  // AI-5: no depot. The row is for those who review applications, the push likewise.
  NotificationEvent.FRANCHISE_APPLICATION_SUBMITTED,
  // HD-12: for the accounts holding waCostRead (APPROVER_CAP_FOR_EVENT), no depot.
  NotificationEvent.WA_CAP_WARNING,
  NotificationEvent.WA_CAP_REACHED,
  // AI-9: addressed to one account (also in PERSONAL_OPS_EVENTS), no depot.
  NotificationEvent.MORNING_SUMMARY,
  // AI-7c: addressed to one account (also in PERSONAL_OPS_EVENTS), no depot.
  NotificationEvent.AI_ACCESS_REQUESTED,
  // HD-15: addressed to one account (also in PERSONAL_OPS_EVENTS); the depot is in the text.
  NotificationEvent.MAINTENANCE_DUE,
  NotificationEvent.PERMIT_DUE,
  NotificationEvent.LAB_TEST_DUE,
  NotificationEvent.QUALITY_HOLD,
  // AI-26: addressed to one account (also in PERSONAL_OPS_EVENTS), no depot.
  NotificationEvent.SALES_WEEKLY_REPORT,
  // AI-31: addressed to one account (also in PERSONAL_OPS_EVENTS), no depot.
  NotificationEvent.AI_AGENT_FLAG,
  NotificationEvent.AI_AGENT_CAP,
  NotificationEvent.AI_AGENT_STOPPED,
  // AI-14: each recipient's own row.
  NotificationEvent.AI_LEAD_NEW,
  NotificationEvent.AI_LEAD_REMIND,
  NotificationEvent.AI_LEAD_ESCALATE,
  // HD-15B: the same, addressed to one account (also in PERSONAL_OPS_EVENTS); the depot is in the text.
  NotificationEvent.VISIT_FINDING,
  NotificationEvent.FOLLOW_UP_OVERDUE,
  // HD-23: addressed to one franchise owner's account (also in PERSONAL_OPS_EVENTS), no depot.
  NotificationEvent.PARTNER_BILL,
  NotificationEvent.PARTNER_BILL_VOID,
  NotificationEvent.STOCK_LOW,
  NotificationEvent.STOCK_UNTRACKED,
  NotificationEvent.METER_VARIANCE,
  NotificationEvent.COURIER_INCIDENT,
  // Emitted by delivery-service with a depotId; only an OPS event is fanned out to the
  // depot's staff and shown in their feed.
  NotificationEvent.DELIVERY_SLA_BREACHED,
  NotificationEvent.DEPOT_SALES_UPDATE,
  // HR events go to staff, so they belong in the ops feed, not a customer inbox. The
  // employee's own leave decisions included — the recipient is an employee either way.
  NotificationEvent.LEAVE_SUBMITTED,
  NotificationEvent.LEAVE_APPROVED,
  NotificationEvent.LEAVE_REJECTED,
  // Kasbon is HR too, and the recipient is an employee at both ends — the decider on the
  // way in, the applicant on the way out. This list has NO type guard, unlike the two
  // template tables: an event missing here compiles and then quietly lands in a CUSTOMER
  // inbox instead of the ops feed.
  NotificationEvent.LOAN_REQUEST_SUBMITTED,
  NotificationEvent.LOAN_REQUEST_APPROVED,
  NotificationEvent.LOAN_REQUEST_REJECTED,
  NotificationEvent.HR_ANNOUNCEMENT,
  // Personal to the employee (salary period, their own lateness): see PERSONAL_OPS_EVENTS.
  NotificationEvent.SHIFT_REMINDER,
  NotificationEvent.PAYSLIP_READY,
  NotificationEvent.ATTENDANCE_LATE,
];

/**
 * The depot alerts a depot's OVERSEERS - assistant supervisor, supervisor, manager - are woken
 * by as well as its own staff: the ones that say something is wrong at a depot they answer
 * for. Routine flow (an order arriving, a receipt, the daily figures) stays with the depot's
 * own people; a manager with sixty depots does not want sixty order feeds.
 */
export const OVERSEER_EVENTS: readonly NotificationEvent[] = [
  NotificationEvent.STOCK_LOW,
  NotificationEvent.STOCK_UNTRACKED,
  NotificationEvent.METER_VARIANCE,
  NotificationEvent.COURIER_INCIDENT,
  NotificationEvent.DELIVERY_SLA_BREACHED,
];

/**
 * The staff settings switch ("Pesanan baru", "Stok menipis", ...) that governs each alert's push.
 * The ids are admin-service's DEPOT_EVENT_IDS, plus `newFranchiseApp`, the one /hq/profile
 * switch with a push behind it ("Lamaran waralaba baru", admin-service PUSH_TOGGLE_IDS). An
 * event with no entry has no switch on any screen - a leave decision, a payslip, a courier's own
 * delivery - and is always pushed.
 */
export type StaffToggle =
  | 'newOrder'
  | 'lowStock'
  | 'courierFail'
  | 'approval'
  | 'dailySummary'
  | 'newFranchiseApp'
  | 'morningSummary'
  | 'aiAccessRequest'
  | 'salesWeekly'
  | 'aiAgent'
  | 'aiLead'
  | 'maintenanceDue'
  | 'visitFinding';

export const STAFF_TOGGLE_FOR_EVENT: Partial<Record<NotificationEvent, StaffToggle>> = {
  [NotificationEvent.DEPOT_ORDER_INCOMING]: 'newOrder',
  [NotificationEvent.DEPOT_ORDER_RESCHEDULED]: 'newOrder',
  [NotificationEvent.DEPOT_ORDER_ADDRESS_CHANGED]: 'newOrder',
  [NotificationEvent.DEPOT_ORDER_CANCELLED]: 'newOrder',
  [NotificationEvent.DEPOT_PAYMENT_PROOF]: 'newOrder',
  [NotificationEvent.DEPOT_PAYMENT_UNCONFIRMED]: 'newOrder',
  [NotificationEvent.STOCK_LOW]: 'lowStock',
  [NotificationEvent.STOCK_UNTRACKED]: 'lowStock',
  [NotificationEvent.METER_VARIANCE]: 'lowStock',
  [NotificationEvent.COURIER_INCIDENT]: 'courierFail',
  [NotificationEvent.DELIVERY_SLA_BREACHED]: 'courierFail',
  [NotificationEvent.APPROVAL_REQUESTED]: 'approval',
  [NotificationEvent.COURIER_SETTLEMENT_SUBMITTED]: 'approval',
  [NotificationEvent.PRICE_OVERRIDE_PROPOSED]: 'approval',
  [NotificationEvent.EXPENSE_CLAIM_SUBMITTED]: 'approval',
  [NotificationEvent.REFUND_REQUESTED]: 'approval',
  // AI-5: its own switch on /hq/profile, not the depot consoles' "approval".
  [NotificationEvent.FRANCHISE_APPLICATION_SUBMITTED]: 'newFranchiseApp',
  // HD-12: a cost warning rides the approval switch (push and email, default on), like the partner bill.
  [NotificationEvent.WA_CAP_WARNING]: 'approval',
  [NotificationEvent.WA_CAP_REACHED]: 'approval',
  // AI-9: its own switch on /hq/profile, push and email, both defaulting on.
  [NotificationEvent.MORNING_SUMMARY]: 'morningSummary',
  // AI-7c: its own switch on /hq/profile, push and email, both defaulting on.
  [NotificationEvent.AI_ACCESS_REQUESTED]: 'aiAccessRequest',
  // HD-15: its own switch on /hq/profile, push and email, both defaulting on.
  [NotificationEvent.MAINTENANCE_DUE]: 'maintenanceDue',
  // HD-14: the same switch: depot upkeep reminders.
  [NotificationEvent.PERMIT_DUE]: 'maintenanceDue',
  [NotificationEvent.LAB_TEST_DUE]: 'maintenanceDue',
  [NotificationEvent.QUALITY_HOLD]: 'maintenanceDue',
  // AI-26: its own switch on /hq/profile, push and email, both defaulting on.
  [NotificationEvent.SALES_WEEKLY_REPORT]: 'salesWeekly',
  // AI-31: one switch for the three agent notices on /hq/profile, push and email, default on.
  [NotificationEvent.AI_AGENT_FLAG]: 'aiAgent',
  [NotificationEvent.AI_AGENT_CAP]: 'aiAgent',
  [NotificationEvent.AI_AGENT_STOPPED]: 'aiAgent',
  // AI-14: one switch for the three form lead notices on /hq/profile, push and email, default on.
  [NotificationEvent.AI_LEAD_NEW]: 'aiLead',
  [NotificationEvent.AI_LEAD_REMIND]: 'aiLead',
  [NotificationEvent.AI_LEAD_ESCALATE]: 'aiLead',
  // HD-15B: one switch for both visit notices (depot lists and /hq/profile), push and email, default on.
  [NotificationEvent.VISIT_FINDING]: 'visitFinding',
  [NotificationEvent.FOLLOW_UP_OVERDUE]: 'visitFinding',
  // HD-23: a money notice an owner must not miss, so it rides the approval switch (default on)
  // rather than a new one; there is no way to read a bill that was switched off, so it stays on.
  [NotificationEvent.PARTNER_BILL]: 'approval',
  [NotificationEvent.PARTNER_BILL_VOID]: 'approval',
  [NotificationEvent.DEPOT_SALES_UPDATE]: 'dailySummary',
};

/**
 * Flow 6b (plan PR-6, owner: "masing-masing ke penyetujunya"): an event that asks for a
 * decision wakes the accounts holding the capability that decides it, not every account at
 * the depot. The depot's own staff and its overseers are checked with `can(cap, role, [depot])`
 * (a per-depot GRANT/DENY decides, as on the route), and the network roles that hold it
 * (finance, head office...) are found by role.
 */
export const APPROVER_CAP_FOR_EVENT: Partial<Record<NotificationEvent, Capability>> = {
  [NotificationEvent.COURIER_SETTLEMENT_SUBMITTED]: 'courierSettle',
  [NotificationEvent.PRICE_OVERRIDE_PROPOSED]: 'priceOverrideDecide',
  [NotificationEvent.EXPENSE_CLAIM_SUBMITTED]: 'expenseApprove',
  [NotificationEvent.REFUND_REQUESTED]: 'refundQueue',
  // AI-5, owner decision: whoever may review applications (head office, the director, and
  // "Sales" once its role is given this capability in the matrix).
  [NotificationEvent.FRANCHISE_APPLICATION_SUBMITTED]: 'franchiseApplications',
  // HD-12: whoever may read the WhatsApp cost screen.
  [NotificationEvent.WA_CAP_WARNING]: 'waCostRead',
  [NotificationEvent.WA_CAP_REACHED]: 'waCostRead',
};

/**
 * CRM-3: ops events addressed to ONE employee — their leave, their kasbon. They carry the
 * amount, the rejection reason and the phone, and no depot (an HR decision is not a depot
 * alert), so the depot filter let every staff account in the network read them. They are
 * shown to their recipient only. HR_ANNOUNCEMENT is deliberately absent: it is for everyone.
 */
export const PERSONAL_OPS_EVENTS: NotificationEvent[] = [
  NotificationEvent.LEAVE_SUBMITTED,
  NotificationEvent.LEAVE_APPROVED,
  NotificationEvent.LEAVE_REJECTED,
  NotificationEvent.LOAN_REQUEST_SUBMITTED,
  NotificationEvent.LOAN_REQUEST_APPROVED,
  NotificationEvent.LOAN_REQUEST_REJECTED,
  NotificationEvent.COURIER_DELIVERY_ASSIGNED,
  NotificationEvent.APPROVAL_REQUESTED,
  NotificationEvent.SHIFT_REMINDER,
  NotificationEvent.PAYSLIP_READY,
  NotificationEvent.ATTENDANCE_LATE,
  // AI-9: counts for one recipient, shown to that recipient only.
  NotificationEvent.MORNING_SUMMARY,
  // AI-7c: one person who can grant AI access; the request names a requester, so for them only.
  NotificationEvent.AI_ACCESS_REQUESTED,
  // HD-15: one recipient's own row (the same text goes to each of them, but each has their own).
  NotificationEvent.MAINTENANCE_DUE,
  NotificationEvent.PERMIT_DUE,
  NotificationEvent.LAB_TEST_DUE,
  NotificationEvent.QUALITY_HOLD,
  // AI-26: each recipient's own row.
  NotificationEvent.SALES_WEEKLY_REPORT,
  // AI-31: each recipient's own row.
  NotificationEvent.AI_AGENT_FLAG,
  NotificationEvent.AI_AGENT_CAP,
  NotificationEvent.AI_AGENT_STOPPED,
  // AI-14: each recipient's own row.
  NotificationEvent.AI_LEAD_NEW,
  NotificationEvent.AI_LEAD_REMIND,
  NotificationEvent.AI_LEAD_ESCALATE,
  // HD-15B: each recipient's own row.
  NotificationEvent.VISIT_FINDING,
  NotificationEvent.FOLLOW_UP_OVERDUE,
  // HD-23: one owner's own row.
  NotificationEvent.PARTNER_BILL,
  NotificationEvent.PARTNER_BILL_VOID,
];

// English. Same tokens, same order, same meaning — including the operational ones, which go
// to a depot's own number: a depot run in English gets its alerts in English too.
const TEMPLATES_EN: Record<NotificationEvent, string> = {
  [NotificationEvent.ORDER_RECEIVED]:
    'Hi {{name}}! We have your order {{orderNumber}} and it is waiting for confirmation. We will get it moving shortly 💧',
  [NotificationEvent.DEPOT_ORDER_INCOMING]:
    'New order in: {{orderNumber}} · {{total}}. Open the queue to process it.',
  [NotificationEvent.DEPOT_ORDER_RESCHEDULED]:
    'The customer moved the delivery of order {{orderNumber}} to {{when}}. Check the queue to adjust.',
  [NotificationEvent.DEPOT_ORDER_ADDRESS_CHANGED]:
    'The customer moved order {{orderNumber}} to {{address}}. Use this address, not the printed one.',
  [NotificationEvent.APPROVAL_REQUESTED]:
    'Waiting for your approval: {{title}} ({{depot}}, {{amount}}). Open Approvals to decide.',
  [NotificationEvent.COURIER_SETTLEMENT_SUBMITTED]:
    'A courier handed in {{amount}} and it waits for checking (variance {{variance}}). Open Settlements to check it.',
  [NotificationEvent.PRICE_OVERRIDE_PROPOSED]:
    '{{depot}} proposed {{count}} price change(s) ({{product}}). Open Pricing to decide.',
  [NotificationEvent.EXPENSE_CLAIM_SUBMITTED]:
    'A courier expense claim of {{amount}} ({{category}}) waits for approval. Open Expense claims to decide.',
  [NotificationEvent.REFUND_REQUESTED]:
    'A refund of {{amount}} waits for head office approval. Open the Refund queue to decide.',
  [NotificationEvent.FRANCHISE_APPLICATION_SUBMITTED]:
    'New franchise application from a prospective partner in {{city}}, {{province}}. Open Franchise applications to review it.',
  [NotificationEvent.MORNING_SUMMARY]: 'Approvals waiting for you: {{summary}}.{{oldest}}',
  [NotificationEvent.SUBSCRIPTION_TOMORROW]:
    'Reminder: your {{product}} subscription ({{quantity}}) is scheduled for delivery tomorrow, {{date}}. Please make sure someone can receive it 💧',
  [NotificationEvent.POINTS_EXPIRING]:
    '{{points}} of your points expire on {{expires}}. Redeem them for a voucher on the Rewards page before they lapse ⭐',
  [NotificationEvent.UNPAID_ORDER]:
    'Order {{orderNumber}} ({{amount}}) is still waiting for payment. Pay now: orders left unpaid are cancelled automatically.',
  [NotificationEvent.AI_ACCESS_REQUESTED]:
    '{{who}} asks for AI web access to {{what}}. Open Legal entities, the AI access section, to grant it.',
  [NotificationEvent.SALES_WEEKLY_REPORT]:
    'Week {{week}}: open the calon mitra report for {{entity}}. {{link}}',
  [NotificationEvent.AI_AGENT_FLAG]: '{{who}} flagged something new. Open Tim AI for details. {{link}}',
  [NotificationEvent.AI_AGENT_CAP]: "{{who}} stopped: this month's cap is reached. Open Tim AI for details. {{link}}",
  [NotificationEvent.AI_AGENT_STOPPED]: '{{who}} was stopped. Open Tim AI for details. {{link}}',
  [NotificationEvent.AI_LEAD_NEW]:
    'New calon mitra from the form in {{city}}, {{province}}. Open the queue and take it within 2 working hours. {{link}}',
  [NotificationEvent.AI_LEAD_REMIND]: 'The calon mitra from {{city}} has not been contacted after 2 working hours. {{link}}',
  [NotificationEvent.AI_LEAD_ESCALATE]:
    'The calon mitra from {{city}} has not been contacted after 4 working hours. Sales Lead must act. {{link}}',
  [NotificationEvent.WA_CAP_WARNING]:
    'WhatsApp number 1: {{category}} is at {{pct}}% of the monthly cap ({{used}}/{{cap}}).',
  [NotificationEvent.WA_CAP_REACHED]:
    'WhatsApp number 1: the {{category}} cap for this month is reached. WhatsApp sending stops; app notifications keep going.',
  [NotificationEvent.MAINTENANCE_DUE]:
    'Maintenance is due at {{depot}}: {{items}}. Open Maintenance to schedule the service.',
  [NotificationEvent.PERMIT_DUE]:
    'Permits at {{depot}} need renewing: {{items}}. Open Lab tests and permits to record the new permit.',
  [NotificationEvent.LAB_TEST_DUE]:
    'Lab tests at {{depot}} are due: {{items}}. Take the test and record the result under Lab tests and permits.',
  [NotificationEvent.QUALITY_HOLD]: '{{text}}',
  [NotificationEvent.VISIT_FINDING]:
    'A supervisor visit to {{depot}} found: {{items}}. Open the visit to review and follow up.',
  [NotificationEvent.FOLLOW_UP_OVERDUE]:
    'Visit follow-ups at {{depot}} are overdue: {{items}}. Open Visits to close them.',
  [NotificationEvent.PARTNER_BILL]:
    'Royalty bill {{month}} for {{entity}}: {{total}}. Transfer to {{bank}} {{number}} in the name of {{holder}}. Details in the app.',
  [NotificationEvent.PARTNER_BILL_VOID]:
    'Royalty bill {{month}} was withdrawn: {{reason}}. A replacement bill will be sent if there is one.',
  [NotificationEvent.PAYMENT_FAILED]:
    'Hi {{name}}, the payment for order {{orderNumber}} did not go through ({{reason}}). Please pay again from the app.',
  [NotificationEvent.PAYMENT_REMINDER]:
    'Hi {{name}}, order {{orderNumber}} is still waiting for its {{amount}} payment. Complete it so we can process your order.',
  [NotificationEvent.REFUND_PROCESSED]:
    'Hi {{name}}, your {{amount}} refund for order {{orderNumber}} has been processed. It returns through your payment method.',
  [NotificationEvent.DEPOT_PAYMENT_UNCONFIRMED]:
    'The {{amount}} payment for order {{orderNumber}} is settled but the order is still unconfirmed. Open the order and confirm it manually.',
  [NotificationEvent.DEPOT_PAYMENT_PROOF]:
    'A payment receipt arrived for order {{orderNumber}} ({{amount}}). Open the order to check the receipt and confirm payment.',
  [NotificationEvent.DEPOT_ORDER_CANCELLED]:
    'The customer cancelled order {{orderNumber}} ({{total}}). Stock is released; no need to process it.',
  [NotificationEvent.COURIER_DELIVERY_ASSIGNED]:
    'New delivery for you: order {{orderNumber}}. Open the app for the address and details.',
  [NotificationEvent.SHIFT_REMINDER]:
    'Hi {{name}}, your shift starts at {{time}}. Remember to check in.',
  [NotificationEvent.PAYSLIP_READY]:
    'Hi {{name}}, your {{period}} payslip is ready. Open My Payroll to view it.',
  [NotificationEvent.ATTENDANCE_LATE]:
    'Hi {{name}}, your check-in on {{date}} was recorded {{minutes}} minutes late.',
  [NotificationEvent.ORDER_CONFIRMED]:
    'Hi {{name}}! Order {{orderNumber}} is confirmed and we are preparing it. Thank you for ordering from Hydromart 💧',
  [NotificationEvent.ORDER_ON_DELIVERY]:
    'Good news, {{name}}! Order {{orderNumber}} is on its way to you. Please have your empty gallons ready if there is an exchange.',
  [NotificationEvent.ORDER_DELIVERED]:
    'Order {{orderNumber}} has arrived. Enjoy your clean water from Hydromart, {{name}}! 💧',
  [NotificationEvent.ORDER_COMPLETED]:
    'Thank you, {{name}}! Order {{orderNumber}} is complete. Your loyalty points have been added — check your balance in the app.',
  [NotificationEvent.ORDER_DRIVER_ASSIGNED]:
    'Hi {{name}}! Order {{orderNumber}} has been picked up by our courier and leaves shortly. From now on it can no longer be cancelled from the app — please contact the depot if anything changes.',
  [NotificationEvent.DELIVERY_RESCHEDULED]:
    'Hi, delivery of order {{orderNumber}} has been rescheduled to {{rescheduledFor}} {{slot}}. {{note}} Sorry for the inconvenience.',
  [NotificationEvent.ORDER_CANCELLED]:
    'Hi {{name}}, order {{orderNumber}} has been cancelled. If you already paid, the money is returned through your payment method. Contact us if you need help.',
  [NotificationEvent.STOCK_LOW]:
    '⚠️ Stock running low at depot {{depot}}: {{item}} down to {{quantity}} (minimum {{minimum}}). Please restock soon.',
  [NotificationEvent.STOCK_UNTRACKED]:
    '⚠️ {{stage}}: order {{order}} at depot {{depot}} contains {{count}} product(s) with no stock line. The sale still goes through, but the stock is NOT deducted. Please create the stock line.',
  [NotificationEvent.METER_VARIANCE]:
    '💧 Water meter variance at depot {{depot}} on {{date}}: {{variance}} litres (± {{gallons}} gallons) against recorded sales. Please check.',
  [NotificationEvent.DELIVERY_SLA_BREACHED]:
    '⏰ Order {{order}} has been on the road {{minutes}} minutes — past the {{threshold}} minute SLA ({{over}} minutes late). Please check on the courier.',
  [NotificationEvent.COURIER_INCIDENT]:
    '🚨 {{severity}} incident reported by a courier — {{category}}: {{note}}. Please follow up immediately.',
  [NotificationEvent.DEPOT_SALES_UPDATE]:
    '{{slot}} sales report for depot {{depot}}: {{gallons}} gallons, {{orders}} orders, revenue {{revenue}}. Counter cash {{counterCash}}, COD {{cod}}.',
  [NotificationEvent.CUSTOMER_REGISTERED]:
    'Welcome to Hydromart, {{name}}! 💧 Your account is active. Order clean water any time from the app. Thank you for joining!',
  [NotificationEvent.PHONE_CHANGED]:
    'Hi {{name}}, the phone number on your Hydromart account was just changed to {{newPhone}}. Sign-in codes now go to that number. Not you? Contact your depot immediately.',
  [NotificationEvent.POINTS_EARNED]:
    'Nice one, {{name}}! You earned +{{points}} points from order {{orderNumber}}. Collect points for vouchers and a higher tier in the app.',
  [NotificationEvent.VOUCHER_GRANTED]:
    'A new voucher for you, {{name}}! Code {{code}} — {{description}}. Use it at checkout before it expires 🎟️',
  [NotificationEvent.VOUCHER_EXPIRING]:
    'Hi {{name}}, voucher {{code}} ends on {{expires}}. Use it before it is gone 🎟️',
  [NotificationEvent.RESELLER_PRICE_CHANGED]:
    'Hi {{name}}, your reseller price has been updated: {{terms}}. Effective now — check the details in the app before your next purchase.',
  [NotificationEvent.RESELLER_DEACTIVATED]:
    'Hi {{name}}, your reseller status has been deactivated, so your next purchases use standard pricing. Contact your depot if this is not right.',
  [NotificationEvent.SUBSCRIPTION_PAUSED]:
    'Hi {{name}}! Your {{product}} subscription is paused because {{reason}}. Nothing is charged while it is paused — open Subscriptions to resume whenever you like.',
  [NotificationEvent.MEMBERSHIP_TIER_UPGRADED]:
    'Congratulations, {{name}}! You have moved up to the {{tier}} tier 🎉 See your new tier benefits on the Rewards page.',
  [NotificationEvent.REORDER_REMINDER]:
    'Hi {{name}}, you may be running low on water. Reorder now for fast delivery from your nearest depot 💧',
  [NotificationEvent.GALLON_RETURN_REMINDER]:
    'Hi {{name}}, you are still holding {{gallons}} gallons that belong to depot {{depot}}, out since {{since}}. If you no longer need them, please return them — you can get the gallon deposit back.',
  [NotificationEvent.REVIEW_REQUEST]:
    'Hi {{name}}, order {{orderNumber}} has arrived. How was it? Leave a quick rating — your feedback helps the depot improve ⭐',
  [NotificationEvent.LEAVE_SUBMITTED]:
    '{{type}} leave request from {{name}} ({{from}} to {{to}}) is waiting for your approval.',
  [NotificationEvent.LEAVE_APPROVED]:
    'Hi {{name}}, your {{type}} leave from {{from}} to {{to}} has been APPROVED. Enjoy the break!',
  [NotificationEvent.LEAVE_REJECTED]:
    'Hi {{name}}, your {{type}} leave from {{from}} to {{to}} was DECLINED. Reason: {{reason}}. Please talk to HR if you need to.',
  [NotificationEvent.LOAN_REQUEST_SUBMITTED]:
    'A cash advance request from {{name}} for Rp{{amount}} is waiting for your decision.',
  [NotificationEvent.LOAN_REQUEST_APPROVED]:
    'Hi {{name}}, your Rp{{amount}} cash advance was APPROVED. Instalments come off your pay automatically — see the details under Kasbon.',
  [NotificationEvent.LOAN_REQUEST_REJECTED]:
    'Hi {{name}}, your Rp{{amount}} cash advance was DECLINED. Reason: {{reason}}. Please talk to your supervisor if you need to.',
  [NotificationEvent.HR_ANNOUNCEMENT]: '📢 {{title}}\n{{body}}',
  [NotificationEvent.BROADCAST]: '{{message}}',
};

export const NOTIFICATION_TEMPLATES: Record<MessageLocale, Record<NotificationEvent, string>> = {
  id: TEMPLATES_ID,
  en: TEMPLATES_EN,
};

/**
 * The template for one event in one language.
 *
 * Defaults to Indonesian, and falls back to it for anything that is not a language we
 * actually hold: the locale arrives from another service's column, and an unknown string
 * must cost the reader their preferred language, never the message itself.
 */
export function templateFor(event: NotificationEvent, locale: MessageLocale = 'id'): string {
  return (NOTIFICATION_TEMPLATES[locale] ?? TEMPLATES_ID)[event];
}

/** Pure, side-effect free. Replaces every {{key}} present in `vars`; unknown tokens are
 *  left intact so a typo surfaces visibly rather than silently blanking. */
export function renderMessage(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  );
}
