// Bantuan (spec 10c): topik, FAQ (accordion), kontak CS.
export const help = {
  complaints: {
    title: "Komplain saya",
    cta: "Ajukan komplain",
    guest: "Masuk dulu untuk mengajukan komplain, supaya kami bisa membalasmu.",
    subject: "Ringkasan masalah",
    subjectHint: "Misal: galon bocor saat diterima",
    orderRef: "Nomor pesanan (opsional)",
    orderRefHint: "Isi kalau komplainnya tentang satu pesanan",
    body: "Ceritakan yang terjadi",
    send: "Kirim komplain",
    sent: "Komplain terkirim. Kami menghubungimu lewat nomor akunmu.",
    sendError: "Gagal mengirim komplain.",
    subjectRequired: "Isi ringkasan masalahnya dulu.",
    bodyRequired: "Ceritakan dulu yang terjadi.",
    cancel: "Batal",
    empty: "Belum ada komplain.",
    reply: "Balasan Hydromart",
    status: { OPEN: "Menunggu ditangani", ASSIGNED: "Sedang ditangani", RESOLVED: "Selesai" },
  },

  title: 'Bantuan',
  searchPlaceholder: 'Cari bantuan…',
  topicsTitle: 'Topik',
  faqTitle: 'Pertanyaan umum',
  noResults: 'Tidak ada hasil untuk "{q}".',
  chatCta: 'Chat dengan CS',
  callAria: 'Hubungi CS',
  topics: {
    delivery: 'Lacak & masalah pengiriman',
    payment: 'Pembayaran & refund',
    gallon: 'Galon, deposit & tukar',
    account: 'Akun & keamanan',
  },
  faq: [
    {
      q: 'Bagaimana cara tukar galon kosong?',
      a: 'Saat kurir tiba, serahkan galon kosongmu — kurir menukarnya dengan galon penuh yang tersegel. Tidak ada biaya tukar selama galon dalam kondisi baik.',
    },
    {
      q: 'Berapa lama refund diproses?',
      a: 'Refund untuk pembayaran non-tunai (QRIS, e-wallet, VA) diproses 1–3 hari kerja ke sumber dana yang sama. Pembayaran COD yang dibatalkan tidak menimbulkan tagihan.',
    },
    {
      q: 'Bisakah ubah alamat setelah pesan?',
      a: 'Selama pesanan belum disiapkan depot, alamat masih bisa diubah dari halaman Lacak pesanan. Setelah kurir berangkat, hubungi CS untuk penyesuaian.',
    },
    {
      q: 'Apa itu poin & tier membership?',
      a: 'Kamu dapat 1 poin tiap belanja {amount}. Poin bisa ditukar voucher/hadiah, dan total poin menaikkan tier (Silver → Gold → Platinum) untuk diskon lebih besar.',
    },
  ],
};
