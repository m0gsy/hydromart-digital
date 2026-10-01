// #34 — public "lacak pesanan" page. Standalone, loaded directly (like franchise.ts), not
// through the main id.ts aggregator: this screen is reached with no session and no app
// shell, the same way /waralaba is.
export const track = {
  title: 'Lacak Pesanan',
  noToken: 'Tidak ada nomor lacak',
  noTokenBody: 'Link ini tidak lengkap. Minta link lacak yang baru dari depot.',
  notFound: 'Link tidak ditemukan',
  notFoundBody:
    'Link ini sudah tidak berlaku, atau salah ketik. Minta link lacak yang baru dari depot.',
  eta: 'Perkiraan tiba sekitar {time}',
  deliveredBy: 'Diantar oleh {name}',
  history: 'Riwayat status',
};
