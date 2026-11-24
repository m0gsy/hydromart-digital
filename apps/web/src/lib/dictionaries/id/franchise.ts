// Pengajuan kemitraan waralaba (design 5a). Form publik, tanpa login.
export const franchise = {
  // H3: the row label on /account — the only way into this form from a phone.
  navLabel: 'Jadi mitra waralaba',
  title: 'Jadi mitra waralaba',
  intro:
    'Isi data calon depot Anda. Tim kami meninjau setiap pengajuan dan menghubungi lewat nomor yang Anda tulis.',
  applicant: 'Data pemohon',
  applicantName: 'Nama lengkap',
  applicantPhone: 'Nomor WhatsApp',
  phoneHint: 'Contoh: 081234567890',
  depot: 'Calon depot',
  proposedCode: 'Kode depot usulan',
  codeHint: 'Singkatan kota + nomor, misal BDG-02',
  proposedName: 'Nama depot',
  city: 'Kota',
  province: 'Provinsi',
  location: 'Titik lokasi',
  locationHint:
    'Isi dari lokasi calon depot agar akurat. Bisa juga diketik manual kalau Anda tahu koordinatnya.',
  useMyLocation: 'Gunakan lokasi saya',
  locating: 'Mengambil lokasi…',
  locationDenied: 'Lokasi tidak bisa diambil. Isi koordinat manual atau coba lagi.',
  lat: 'Lintang (latitude)',
  lng: 'Bujur (longitude)',
  money: 'Rencana keuangan',
  // Franchise copy never says "investasi" or "investor": a partner scheme worded as an
  // investment can be judged an unlicensed investment offer (Rencana Induk 4.1). Both
  // amounts are the applicant's own estimate, never a figure Hydromart promises.
  investmentAmount: 'Kisaran modal (Rp)',
  projectedMonthlyRevenue: 'Perkiraan omzet Anda per bulan (Rp)',
  // CA-3-53: formulir ini mengumpulkan nama, nomor WhatsApp, dan titik GPS tanpa pernah
  // meminta persetujuan dan tanpa pernah menautkan kebijakan privasi. Kalimatnya dipecah
  // supaya "Kebijakan Privasi" bisa jadi tombol yang membuka policy di tempat — link
  // `target="_blank"` tidak berfungsi di WebView Android (lihat components/privacy-sheet).
  consentPre: 'Saya setuju data yang saya isi di formulir ini diproses sesuai ',
  consentPrivacy: 'Kebijakan Privasi',
  consentPost:
    ' Hydromart. Pengajuan yang ditolak dihapus paling lama 24 bulan sejak keputusannya.',
  needConsent: 'Persetujuan pemrosesan data wajib dicentang sebelum mengirim.',
  submit: 'Kirim pengajuan',
  needName: 'Nama pemohon wajib diisi.',
  needPhone: 'Nomor WhatsApp belum benar. Contoh: 081234567890.',
  needCode: 'Kode depot usulan wajib diisi.',
  needDepotName: 'Nama depot wajib diisi.',
  needCity: 'Kota wajib diisi.',
  needProvince: 'Provinsi wajib diisi.',
  badCity: "Kota hanya boleh berisi huruf, spasi, dan tanda . , ' ( ) -; beri spasi setelah titik",
  badProvince: "Provinsi hanya boleh berisi huruf, spasi, dan tanda . , ' ( ) -; beri spasi setelah titik",
  needLocation: 'Titik lokasi wajib diisi.',
  needMoney: 'Kisaran modal dan perkiraan omzet harus angka 0 atau lebih.',
  submitError: 'Pengajuan gagal terkirim. Coba lagi sebentar lagi.',
  sentTitle: 'Pengajuan terkirim',
  sentBody:
    'Terima kasih. Tim kemitraan akan meninjau dan menghubungi Anda lewat WhatsApp. Simpan nomor tanda terima di bawah ini.',
  sentReceipt: 'Nomor tanda terima',
  sentCode: 'Kode depot usulan',
  sentAt: 'Waktu kirim',
  sentAnother: 'Kirim pengajuan lain',
};
