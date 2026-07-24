// Per-depot business-settings editor (delivery tunables today; more services
// append here per SETTINGS_SERVICES). en/settings.ts mirrors this exact shape.
export const settings = {
  title: 'Pengaturan',
  subtitle: 'Nilai bawaan jaringan & override per depot untuk parameter operasional.',
  value: 'Nilai',
  scopeGlobal: 'Default jaringan',
  scopeDepot: 'Depot tertentu',
  pickDepot: 'Pilih depot',
  noDepots: 'Belum ada depot untuk dipilih.',
  envDefault: 'Bawaan: {v}',
  save: 'Simpan',
  reset: 'Ikut default',
  saveError: 'Gagal menyimpan pengaturan.',
  resetError: 'Gagal mengembalikan ke bawaan.',
  emptyTitle: 'Belum ada pengaturan',
  emptyBody: 'Layanan ini belum mengekspos parameter yang bisa diubah.',
  gateTitle: 'Khusus manajer depot',
  gateBody: 'Editor pengaturan hanya untuk manajer depot dan super admin.',
  globalOnly: 'Nilai ini diatur secara global untuk seluruh jaringan, tidak bisa di-override per depot.',
  globalOnlyDeliveryFee:
    'Ini hanya nilai cadangan global. Ongkir per galon yang sebenarnya diatur per depot di halaman Depot.',
  globalWriteDenied: 'Hanya SUPER_ADMIN yang dapat mengubah default global.',
};
