import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
const ROOT = 'apps/web/src';
const W = ['pendapatan','ringkas','tampil','urut','halaman','pencarian','penyesuaian','transaksi','saldo','pengeluaran','pemasukan','rekening','tunai','transfer','kembalian','struk','nota','faktur','pajak','diskon','promo','kupon','voucher','undian','peringkat','wilayah','provinsi','kota','kecamatan','kelurahan','jalan','patokan','armada','kendaraan','motor','mobil','tangki','ulang','minum','botol','segel','kualitas','laboratorium','sampel','sertifikat','perizinan','mitra','waralaba','pemilik','komisi','hasil','sewa','kontrak','perjanjian','pembaruan','pemberitahuan','peringatan','kesalahan','sukses','proses','antrian','antrean','tunda','batalkan','selesaikan','kirimkan','unduhan','unggah','berkas','dokumen','lampiran','gambar','foto','kamera','lokasi','peta','koordinat','jarak','radius','ongkos','gratis','bayar','lunas','cicilan','tempo','denda','bunga','pokok','angsuran','tren','naik','turun','stabil','grafik','diagram','kolom','baris','filter','salin','bagikan','sembunyikan','tampilkan','perbarui','segarkan','sinkron','terhubung','terputus','luring','daring','perangkat','ponsel','tablet','komputer','layar','ukuran','warna','tema','gelap','terang','bahasa','indonesia','inggris','pengguna','peran','akses','izinkan','larang','kunci','lupa','profil','tentang','versi','umpan','balik','saran','keluhan','tanggapan','bintang','komentar','tulis','kosongkan','pilihan','opsi','pengecekan','pemeriksaan','pengecualian','penugasan','penjadwalan','pergantian','rekap','arsip','cadangan','pulihkan','permanen','sementara','sisa','tersisa','terjual','terkirim','diterima','ditolak','tertunda','berjalan','berhenti','akhir','awal','sepanjang','selama','sejak','hingga','sampai','antara','sekitar','minimal','maksimal','keseluruhan','penerimaan','pengembalian','penukaran','klaim','garansi','servis','perawatan','perbaikan','rusak','buruk','normal','kritis','darurat','penting','rendah','tinggi'];
const RE = new RegExp('(^|[^a-zA-Z])(' + W.join('|') + ')([^a-zA-Z]|$)', 'i');
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
    for (const m of l.matchAll(/'([^'\n]{4,90})'|"([^"\n]{4,90})"|>([^<>{}\n]{4,90})</g)) {
      const s = (m[1] ?? m[2] ?? m[3] ?? '').trim();
      if (!s) continue;
      if (/^https?:|^\//.test(s)) continue;
      if (!RE.test(s)) continue;
      if (/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)+$/.test(s)) continue;
      if (/i18n-ok/.test(l) || /i18n-ok/.test(lines[i - 1] || '')) continue;
      out.push([rel, i + 1, s, l.trim().slice(0, 120)]);
    }
  });
}
const byFile = new Map();
for (const [f, l, s, ctx] of out) {
  if (!byFile.has(f)) byFile.set(f, []);
  byFile.get(f).push(l + ': ' + s + '   || ' + ctx);
}
const sorted = [...byFile].sort((a, b) => b[1].length - a[1].length);
console.log('TOTAL', out.length, 'in', byFile.size, 'files');
for (const [f, h] of sorted) console.log('\n' + f + ' (' + h.length + ')\n  ' + h.slice(0, 8).join('\n  '));
