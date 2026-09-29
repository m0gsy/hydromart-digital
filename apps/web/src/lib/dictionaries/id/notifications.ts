import type { NotificationEvent } from '@/lib/types';

// Notifikasi inbox (spec 5h): feed event-triggered dari crm-service.
export const notifications = {
  title: 'Notifikasi',
  // O4: dibacakan pembaca layar sebagai ganti judul biasa saat ada yang belum dibaca.
  unreadAria: 'Notifikasi ({n} belum dibaca)',
  markRead: 'Tandai dibaca',
  emptyTitle: 'Tidak ada notifikasi',
  emptyBody: 'Update pesanan & promo akan tampil di sini.',
  // Judul per-event; body memakai `message` tersimpan dari server.
  events: {
    ORDER_RECEIVED: 'Pesanan diterima',
    ORDER_CONFIRMED: 'Pesanan dikonfirmasi',
    ORDER_ON_DELIVERY: 'Pesanan dalam perjalanan',
    ORDER_DELIVERED: 'Pesanan terkirim',
    ORDER_COMPLETED: 'Pesanan selesai',
    ORDER_CANCELLED: 'Pesanan dibatalkan',
    ORDER_DRIVER_ASSIGNED: 'Kurir ditugaskan',
    DELIVERY_RESCHEDULED: 'Pengiriman dijadwalkan ulang',
    CUSTOMER_REGISTERED: 'Selamat datang di Hydromart',
    DEPOT_ORDER_INCOMING: 'Pesanan baru masuk',
    STOCK_LOW: 'Stok menipis',
    POINTS_EARNED: 'Poin bertambah',
    MEMBERSHIP_TIER_UPGRADED: 'Naik tier membership',
    VOUCHER_GRANTED: 'Voucher baru',
    // F3 mengulang: kedua event ini dikirim sejak 2026-09-28 tapi lupa didaftarkan di
    // kamus, jadi judulnya tampil sebagai string mentah `notifications.events.…` di
    // kotak masuk pelanggan sungguhan. `satisfies` di bawah membuat ini mustahil terulang.
    GALLON_RETURN_REMINDER: 'Galon belum dikembalikan',
    REVIEW_REQUEST: 'Beri penilaian',
    REORDER_REMINDER: 'Saatnya isi ulang?',
    // F3: kampanye adalah satu-satunya event yang pasti dilihat pelanggan, dan selama ini
    // tampil sebagai string mentah `notifications.events.BROADCAST`.
    BROADCAST: 'Kabar dari Hydromart',
    // Event operasional — tampil di umpan staf, bukan kotak masuk pelanggan.
    STOCK_UNTRACKED: 'Penjualan tanpa kartu stok',
    METER_VARIANCE: 'Selisih meteran air',
    COURIER_INCIDENT: 'Insiden kurir',
    DEPOT_SALES_UPDATE: 'Penjualan depot hari ini',
    LEAVE_SUBMITTED: 'Pengajuan cuti masuk',
    LEAVE_APPROVED: 'Cuti disetujui',
    LEAVE_REJECTED: 'Cuti ditolak',
    HR_ANNOUNCEMENT: 'Pengumuman HR',
  } satisfies Record<NotificationEvent, string>,
};
