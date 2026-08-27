import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
const ROOT = 'apps/web/src';
// Indonesian morphology + very common function words. Broad on purpose; we eyeball output.
const MORPH = /(^|\s)(di|ke|se|ber|mem|men|meng|meny|pe|per|peng|pem|pen|ter)[a-z]{3,}|[a-z]{3,}(kan|nya|an|i)(\s|$)/i;
const STOP = /\b(yang|dan|atau|tidak|belum|sudah|akan|ini|itu|untuk|dari|dengan|pada|per|ada|bisa|harus|wajib|saja|juga|semua|setiap|lebih|kurang|baru|lama|hari|bulan|tahun|minggu|jam|menit|tanggal|nama|jumlah|nilai|harga|biaya|depot|pesanan|pelanggan|kurir|stok|galon|poin|simpan|batal|hapus|ubah|tambah|cari|pilih|kirim|muat|lihat|kembali|lanjut|selesai|gagal|berhasil|kosong|aktif|nonaktif|tersedia|masuk|keluar|catatan|jenis|periode|laporan|ringkasan|rincian|daftar|riwayat|pengaturan|dibuat|diubah|dihapus|disetujui|ditolak|menunggu|dibayar|terlambat|anda|kamu|antar|pengiriman|penjualan|pembelian|pembayaran|setoran|penarikan|kasir|gudang|jadwal|tugas|hadiah|langganan|keranjang|alamat|akun|sandi|masalah|bantuan|ulasan|penilaian|target|capaian|setujui|tolak|kelola|buat|tutup|cetak|unduh|ekspor|impor|ganti|atur|mulai|ambil|terima|tunggu|ulangi|coba|periksa)\b/i;
function walk(d, o = []) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) {
      if (!['node_modules', 'dictionaries', '__tests__', '__mocks__'].includes(n)) walk(p, o);
    } else if (/\.tsx?$/.test(p) && !/\.(test|spec)\./.test(p)) o.push(p);
  }
  return o;
}
const targets = process.argv.slice(2);
const out = [];
for (const f of walk(ROOT)) {
  const rel = relative(ROOT, f).split('\\').join('/');
  if (!targets.some((t) => rel.startsWith(t))) continue;
  const src = readFileSync(f, 'utf8');
  const lines = src.split(/\r?\n/);
  lines.forEach((l, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
    if (/className|classname/.test(l) && !/>/.test(l)) return;
    for (const m of l.matchAll(/'([^'\n]{6,110})'|"([^"\n]{6,110})"|`([^`\n]{6,110})`|>([^<>{}\n]{6,110})</g)) {
      let s = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim();
      if (!s) continue;
      if (!/\s/.test(s)) continue; // must be multi-word
      if (/^https?:|^\//.test(s)) continue;
      if (/[:;{}]|=>|&&|\|\|/.test(s)) continue;
      if (/^(flex|grid|text-|bg-|w-|h-|p-|m-|border|rounded|gap-|items-|justify-)/.test(s)) continue;
      if (/\b(text|bg|border|rounded|flex|grid|gap|px|py|mt|mb|ml|mr|w|h|min|max|sm|md|lg|xl)-/.test(s)) continue;
      if (!MORPH.test(s) && !STOP.test(s)) continue;
      if (/i18n-ok/.test(l) || /i18n-ok/.test(lines[i - 1] || '')) continue;
      out.push([rel, i + 1, s, l.trim().slice(0, 130)]);
    }
  });
}
const byFile = new Map();
for (const [f, l, s, ctx] of out) {
  if (!byFile.has(f)) byFile.set(f, []);
  byFile.get(f).push(l + ': ' + JSON.stringify(s) + '  || ' + ctx);
}
console.log('TOTAL', out.length, 'in', byFile.size, 'files');
for (const [f, h] of [...byFile].sort((a, b) => b[1].length - a[1].length))
  console.log('\n' + f + ' (' + h.length + ')\n  ' + h.join('\n  '));
