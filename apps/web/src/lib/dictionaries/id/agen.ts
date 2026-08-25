// K4.1: layar status agen. Sebelum ini tidak ada apa pun sisi agen — seorang agen tidak
// punya cara melihat apakah dirinya masih aktif atau berapa harganya, dan satu-satunya
// jejaknya adalah lencana di checkout yang justru hilang ketika pembacaannya gagal.
export const agen = {
  title: 'Status agen',
  subtitle: 'Harga khusus dan depot asal yang berlaku untuk akunmu.',

  activeTitle: 'Kamu terdaftar sebagai agen',
  inactiveTitle: 'Keagenanmu sedang nonaktif',
  inactiveBody:
    'Harga agen tidak dipakai selama status ini nonaktif. Hubungi depot asalmu untuk mengaktifkannya kembali.',

  flatLabel: 'Harga galon khusus',
  discountLabel: 'Potongan agen',
  depotLabel: 'Depot asal',
  depotUnknown: 'Depot asal belum tercatat',

  // Kenapa depot asal ditampilkan sama menonjolnya dengan harga: harga agen hanya berlaku
  // di depot itu, dan itu satu-satunya alasan paling sering harga agen tidak muncul.
  depotNote: 'Harga agen hanya berlaku untuk pesanan dari depot ini.',

  changesTitle: 'Perubahan harga',
  changesBody: 'Setiap perubahan harga atau status dikirim ke Notifikasi.',

  notAgentTitle: 'Akunmu belum terdaftar sebagai agen',
  notAgentBody:
    'Agen adalah pelanggan yang membeli dalam jumlah besar dari satu depot dan menjualnya kembali. Pendaftarannya lewat depot — hubungi depot terdekat untuk menanyakan syaratnya.',

  loadError: 'Status agen tidak bisa dibaca sekarang.',
  accountRow: 'Status agen',
};
