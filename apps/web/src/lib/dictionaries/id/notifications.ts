// Notifikasi inbox (spec 5h): feed event-triggered dari crm-service.
export const notifications = {
  title: 'Notifikasi',
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
    CUSTOMER_REGISTERED: 'Selamat datang di Hydromart',
    STOCK_LOW: 'Stok menipis',
    POINTS_EARNED: 'Poin bertambah',
    VOUCHER_GRANTED: 'Voucher baru',
    REORDER_REMINDER: 'Saatnya isi ulang?',
  },
};
