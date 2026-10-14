# Bab 12 — Matriks Peran & Izin

| | |
|---|---|
| **Versi** | 0.1 draf |
| **Tanggal** | 2026-10-10 (dicocokkan ulang dengan kode pasca PR #664 pada 2026-10-14) |
| **Klasifikasi** | Internal — Rahasia |
| **Sumber utama** | `packages/access/src/index.ts` (106 kapabilitas di `main`; 110 di cabang `fix/uat-g128-g149-g152` sampai commit 609a497, belum di `main`), `apps/web/src/lib/roles.ts`, `apps/web/src/lib/hq-nav.ts`, `apps/web/src/components/dashboard/ops-rail.tsx`, temuan A–I dan K |
| **Status pengujian** | Belum ada pengujian di aplikasi yang dijalankan oleh penulis dokumen ini. Semua nilai berasal dari pembacaan kode. Perbaikan di cabang `fix/uat-g128-g149-g152` (609a497) belum ada di `main` dan belum diuji ulang. |

Bab ini menjawab satu pertanyaan: **siapa boleh melakukan apa, dan dengan syarat apa.** Nilai disusun per modul, berdasarkan **kapabilitas nyata di kode** (kolom "Bukti"), bukan berdasarkan nama peran.

## 1. Cara membaca bab ini

### 1.1 Catatan wajib (baca dahulu)

1. **Nilai adalah BAWAAN.** Semua nilai di bab ini adalah isi `CAPABILITIES` yang dikirim bersama aplikasi. **SUPER_ADMIN dapat mengubahnya saat runtime** lewat layar "Peran & hak akses" (`/hq/access`). Perubahan berlaku di seluruh layanan dalam kira-kira 30 detik (polling 30 detik, cache auth 15 detik). Bila sumber perubahan tidak terjangkau lebih dari 5 menit, layanan kembali ke nilai bawaan. **[V]**
2. **SUPER_ADMIN selalu lolos.** Fungsi `can()` mengembalikan benar untuk SUPER_ADMIN sebelum membaca perubahan apa pun, jadi SUPER_ADMIN tidak bisa kehilangan kapabilitas lewat penyuntingan matriks. Satu-satunya penjaga tambahan: `accessMatrixWrite` tidak boleh dilepas dari SUPER_ADMIN (ditolak "SUPER_ADMIN tidak boleh dilepas dari accessMatrixWrite."). **[V]**
3. **Tampilan bukan izin.** Layar sering menampilkan tombol yang akan ditolak server. Tanda **[B]** pada penjelasan sel menandai kasus yang diketahui. Server selalu menjadi penentu: tombol yang tampil belum tentu boleh dipakai, dan menu yang tersembunyi bukan jaminan keamanan. **[V]**
4. **Cakupan depot menentukan data yang terlihat**, terpisah dari boleh/tidaknya aksi (lihat 1.4).
5. **Kapabilitas per peran tidak berubah oleh PR #664 (2026-10-14) di `main`; berubah di cabang `fix/uat-g128-g149-g152` (609a497): +4 kapabilitas baca (106 menjadi 110), belum di `main` (lihat butir 7 dan bagian 6.1).** Perbandingan `packages/access/src/index.ts` pada commit e01db63 dan HEAD (tanpa komentar) hanya berbeda satu baris: `RESTRICTED_GRANTS` mendapat `HEAD_OFFICE: ['SUPER_ADMIN']`. Isi `CAPABILITIES` dan tabel di bagian 6 tetap sah; yang diperbarui hanya aturan pemberian peran (bagian 3.16, 5.3), catatan [B] yang sudah diperbaiki, dan log verifikasi (bagian 7). **[V]**
6. Pernyataan "tidak diuji" berlaku untuk seluruh bab ini. Sel bertanda **Tidak terverifikasi** adalah kasus di mana pembacaan kode saja tidak cukup untuk memastikan hasil di layar.
7. **Nilai "cabang" dipisahkan dari nilai `main`.** Tabel bagian 3 dan tabel utama bagian 6 (106 kapabilitas) tetap menggambarkan `main`. Empat kapabilitas baca tambahan dari commit 609a497 pada cabang `fix/uat-g128-g149-g152` (di atas 5a8ae4a) dicatat terpisah di bagian 6.1 dan ditandai **hanya di cabang, belum di `main`, belum diuji ulang**. Bila cabang digabung, jumlah menjadi 110. **[V]**

### 1.2 Nilai sel

| Nilai | Arti |
|---|---|
| **Ya** (Diizinkan) | Peran memegang kapabilitas dan tidak ada syarat tambahan yang tercatat. |
| **Dibatasi** | Diizinkan, tetapi sempit: hanya baca, hanya data sendiri, hanya jenis tertentu. Penjelasan wajib ada di bawah tabel. |
| **Bersyarat** | Diizinkan bila syarat terpenuhi: cakupan depot, maker-checker (pengaju tidak boleh pemutus), ambang rupiah, fitur yang harus menyala, urutan langkah. Penjelasan wajib ada di bawah tabel. |
| **—** (Tidak tersedia) | Peran tidak memegang kapabilitas, atau layar/rute tidak ada untuknya. |
| **?** / Tidak terverifikasi | Kode tidak cukup untuk memastikan hasilnya. Dijelaskan di bawah tabel. |

Angka dalam kurung siku, mis. `[3.4]`, merujuk ke penjelasan di bawah tabel modul yang sama. Tag bukti pada penjelasan: **[V]** terverifikasi di kode, **[D]** disimpulkan dan perlu konfirmasi, **[K]** perlu konfirmasi bisnis (nilai berasal dari data/pengaturan), **[B]** diketahui bermasalah atau tidak konsisten.

### 1.3 Kategori izin

| Kategori | Contoh |
|---|---|
| View | Melihat daftar, laporan, detail |
| Create | Membuat pesanan, mencatat retur, membuat voucher |
| Edit | Mengubah status, stok, harga, data depot |
| Submit | Mengirim/menutup/mengajukan: tutup buku, setoran, penarikan |
| Approve | Menyetujui atau memutus: approval, refund, kasbon, cuti |
| Reject | Menolak (umumnya wajib alasan) |
| Delete | Menghapus, membatalkan, void |
| Export | Mengunduh berkas laporan/audit |
| Configure | Mengubah setelan, ambang, aturan |
| Manage access | Mengundang staf, memberi peran, mengubah matriks/hierarki |

### 1.4 Cakupan depot

| Jenis cakupan | Peran | Arti | Bukti |
|---|---|---|---|
| **Terkunci satu depot (DEPOT_LOCKED)** | STAFF_DEPOT, KEPALA_DEPOT | Hanya depot penempatan di token. Akun tanpa depot ditolak: "Akun ini belum diberi tanggung jawab depot manapun." Depot lain ditolak: "Akun ini hanya boleh mengakses depot yang menjadi tanggung jawabnya." | `depot-scope.ts:11` **[V]** |
| **Himpunan depot (multi-depot)** | ASSISTANT_SUPERVISOR, SUPERVISOR, MANAGER | Depot sendiri ∪ turunan hierarki ∪ hibah langsung. ASPV = depot yang ia asuh; SPV = depot milik ASPV bawahannya; MANAGER = depot milik ASPV di bawah SPV bawahannya. Depot tanpa asisten supervisor tidak masuk cakupan siapa pun kecuali hibah langsung. Hierarki hanya bisa diubah SUPER_ADMIN (`hierarchyAdmin`). Perubahan berlaku ± 60 detik. | `hierarchy.service.ts`, `depot-scope-resolver.ts:7` **[V]** |
| **Jaringan** | DIREKTUR, HEAD_OFFICE, FINANCE, HR, MARKETING, SUPER_ADMIN | Data seluruh jaringan; banyak daftar dibatasi 50/100 baris tanpa penanda (lihat bab 09). | `index.ts` **[V]** |
| **Milik sendiri** | FRANCHISE_OWNER | Hanya depot dengan `ownerId` = akunnya, dan buku kas payout sendiri. | `depot.controller.ts:233-278` **[V]** |
| **Data sendiri** | CUSTOMER; fitur "saya" milik staf | Hanya akun yang masuk. | **[V]** |

### 1.5 Peran dan singkatan di tabel

| Singkatan | Nama di UI | Kode | Konsol utama | Jumlah kapabilitas bawaan (`main`) | Di cabang 609a497 (belum di `main`) |
|---|---|---|---|---|---|
| CUS | Pelanggan | `CUSTOMER` | Aplikasi/situs belanja | 0 (memakai rute berperan CUSTOMER) | 0 (tetap) |
| KD | Kepala depot | `KEPALA_DEPOT` | Konsol operator `/dashboard` (tab atas) | 38 | 40 (+2) |
| STF | Staf depot (= kurir) | `STAFF_DEPOT` | Aplikasi kurir `/driver` | 12 | 12 (tetap) |
| SPV | SPV | `SUPERVISOR` | `/dashboard` (rel kiri) | 21 | 23 (+2) |
| ASPV | Asisten SPV | `ASSISTANT_SUPERVISOR` | `/dashboard` (rel kiri) | 15 | 17 (+2) |
| FRA | Pemilik waralaba | `FRANCHISE_OWNER` | `/dashboard/franchise` | 6 | 8 (+2) |
| HR | HR | `HR` | `/hr` | 10 | 10 (tetap) |
| HO | Kantor pusat (Head office) | `HEAD_OFFICE` | `/hq` | 56 | 60 (+4) |
| SA | Super admin | `SUPER_ADMIN` | `/hq` dan semua konsol | 106 (semua) | 110 (+4) |
| MGR | Manajer | `MANAGER` | `/dashboard`, `/m/manager` (ponsel) | 68 | 72 (+4) |
| DIR | Direktur | `DIREKTUR` | `/hq` | 46 | 50 (+4) |
| FIN | Finance | `FINANCE` | `/hq` (terbatas) | 21 | 25 (+4) |
| MKT | Marketing | `MARKETING` | `/dashboard/campaigns` | 18 | 18 (tetap) |

Jumlah `main` dihitung ulang dari kode pada penulisan ini (bagian 6); jumlah cabang dihitung dengan skrip penghitung yang sama pada `git show origin/fix/uat-g128-g149-g152:packages/access/src/index.ts` (bagian 6.1 dan 7). Urutan rantai depot: STAFF_DEPOT → KEPALA_DEPOT → ASSISTANT_SUPERVISOR → SUPERVISOR → MANAGER → DIREKTUR. **[V]**

Pemetaan istilah permintaan: "Staff Depot" di dokumen ini = peran `STAFF_DEPOT`, yang di kode adalah **kurir** (masuk ke `/driver`). "Admin" = `SUPER_ADMIN` (di UI tertulis "Super admin"). "HQ" = `HEAD_OFFICE` (UI "Head office"/"Kantor pusat"); DIREKTUR dan FINANCE juga melewati pintu `/hq`.

## 2. Ringkasan satu paragraf per peran

| Peran | Ringkasan (bawaan) |
|---|---|
| **Customer** | Belanja, bayar, lacak, batalkan (bersyarat), nilai, tukar poin, langganan, ajukan hapus akun/salinan data. Tidak memegang kapabilitas staf. Tanpa checkout tamu: keranjang dan pesanan butuh masuk. |
| **Kepala depot** | Operasional satu depot: antrean, kasir dan shift kasir, stok dan opname, retur, verifikasi setoran COD, tutup buku, insiden, aturan promo depot, broadcast. **Tidak** memegang approval, refund, pengadaan, pengaturan depot, pembayaran/QRIS, atau laporan keuangan. |
| **Staf depot (kurir)** | Pengantaran sendiri: ambil, antar, bukti, COD tunai, setoran, dompet, klaim, retur di pintu. Meteran air. Tidak ada kasir, stok, atau verifikasi. |
| **Supervisor** | Pengawasan beberapa depot. Banyak layar baca-saja, tetapi **menulis**: ubah status pesanan, dispatch (tugaskan/tarik/batalkan), insiden, sengketa, target, buku kas. Mengusulkan peminjaman karyawan. Tidak memutus kasbon atau cuti. |
| **Asisten SPV** | Pengawasan baca-saja, ditambah dispatch dan ubah status pesanan, serta **memutus kasbon** staf depotnya (pengecualian yang disengaja di kode). |
| **Waralaba** | Dasbor sendiri, buku kas payout, tarik saldo, daftar rekening, baca retur dan prakiraan depot miliknya. Tidak menjalankan operasi depot. |
| **HR** | Karyawan, absensi, payroll, tunjangan, cuti tahap 1 dan 2, kasbon, aset, pengumuman, setelan gaji (override depot), penugasan lintas depot. Tidak mengundang staf di `/hq/staff`. |
| **HQ (Head office)** | Pintu `/hq`: undang staf (hanya 5 peran: Staf depot, Kepala depot, Asisten SPV, SPV, Pemilik waralaba; Head office tidak lagi sejak PR #664, 2026-10-14), lamaran waralaba, harga jaringan, buka kembali buku, PDP, back-office, laporan. Tidak: membuat/menangguhkan depot, memutus refund, rilis payout, membuat kampanye (tombolnya tampil tetapi ditolak server, **[B]**). Boleh menulis katalog produk. |
| **Admin (Super admin)** | Semua kapabilitas, plus matriks akses, hierarki, hapus staf, platform (flag, kunci API, webhook, retensi, keamanan), setelan global. |
| **Manajer (lampiran)** | Pemegang kapabilitas depot terluas (68), termasuk approval, pengadaan, refund (mulai), klaim, cuti tahap 1, kasbon eskalasi. Bukan pintu `/hq`. |
| **Direktur (lampiran)** | Baca jaringan luas + keputusan HQ (harga, lamaran, fraud, rilis payout). Tidak: undang staf, PDP, ambang approval, ubah data. |
| **Finance (lampiran)** | Refund (putus), payout, komisi, pajak, payroll (bersama HR), rekonsiliasi. Pintu `/hq` terbuka, tetapi beberapa layar galat izin pada `main` (bagian 5); diperbaiki di cabang `fix/uat-g128-g149-g152` (609a497), belum di `main`, belum diuji ulang. |
| **Marketing (lampiran)** | Kampanye, promo, voucher, loyalty, katalog hadiah, churn. Tidak lewat pintu `/hq`. |

## 3. Matriks per modul

Kolom: **CUS** Customer · **KD** Kepala depot · **STF** Staf depot/kurir · **SPV** · **ASPV** · **FRA** Waralaba · **HR** · **HO** Head office · **SA** Admin · lalu lampiran **MGR** Manajer · **DIR** Direktur · **FIN** Finance · **MKT** Marketing.

Sel "Ya" pada baris berkapabilitas berarti peran ada di daftar `CAPABILITIES[kapabilitas]` (dihitung dengan skrip dari kode; bagian 6). Untuk baris tanpa kapabilitas (rute pelanggan, aplikasi kurir) buktinya disebut di kolom Bukti.

### 3.1 Pesanan

**Cakupan:** Staf depot dan Kepala depot terkunci ke satu depot; ASPV/SPV/MGR melihat himpunan depot; HO/DIR melihat jaringan; Waralaba tidak punya akses antrean. [V]

| # | Aksi | Kat. | CUS | KD | STF | SPV | ASPV | FRA | HR | HO | SA | MGR | DIR | FIN | MKT | Bukti (kapabilitas / kode) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1.1 | Lihat antrean pesanan depot | View | — | Ya | Ya | Ya | Ya | — [1.1] | — | Ya | Ya | Ya | Ya | — | — | `orderQueue` |
| 1.2 | Membuat pesanan sendiri (keranjang, checkout) | Create | Ya | — | — | — | — | — | — | — | ? [1.2] | — | — | — | — | rute pelanggan (peran CUSTOMER), tanpa kapabilitas |
| 1.3 | Membatalkan pesanan sendiri | Delete | Bersyarat [1.3] | — | — | — | — | — | — | — | — | — | — | — | — | order-status.ts isCancellable |
| 1.4 | Mengubah status pesanan (Lanjut ke Dikonfirmasi/Disiapkan) | Edit | — | Bersyarat [1.4] | Dibatasi [1.5] | Ya | Ya | — | — | — | Ya | Ya | — | — | — | `orderFulfilment` · order.controller.ts:867 |
| 1.5 | Menugaskan kurir / Tarik ke antrean / Batalkan pengiriman | Edit | — | Bersyarat [1.6] | — | Ya | Ya | — | — | — | Ya | Ya | — | — | — | `tracking` · delivery.controller.ts:24 |
| 1.6 | Konfirmasi pembayaran lunas / tandai gagal | Submit | — | Ya | Dibatasi [1.7] | — | — | — | — | — | Ya | Ya | — | Dibatasi [1.8] | — | `paymentSettle` · payment.controller.ts:599 |
| 1.7 | Melihat panel pembayaran pesanan | View | — | Ya | Ya | Ya | Ya | — | — | Ya | Ya | Ya | Ya | Ya | — | `paymentRead` |
| 1.8 | Mengajukan refund pesanan | Create | — | — | — | — | — | — | — | — | Bersyarat [1.9] | Bersyarat [1.10] | — | Bersyarat [1.11] | — | `refundIssue` · payment.controller.ts:629 |

**Penjelasan sel Dibatasi / Bersyarat / Tidak terverifikasi / catatan:**

- **[1.1]** Tombol "Antrean" tampil di menu ponsel Waralaba, tetapi server tidak memberi orderQueue. [B]
- **[1.2]** SUPER_ADMIN memegang semua kapabilitas, tetapi rute pelanggan ber-@Roles(CUSTOMER); tidak diuji. [D]
- **[1.3]** Hanya status Dipesan/Dikonfirmasi/Disiapkan dan kurir belum pernah ditugaskan (BR-006). [V]
- **[1.4]** UI hanya menawarkan CREATED lalu CONFIRMED lalu PREPARING; tidak ada tombol batalkan pesanan di antrean. [V]
- **[1.5]** Kapabilitas ada, tetapi aplikasi kurir tidak punya layar antrean; hanya lewat alamat /dashboard/orders. [D]
- **[1.6]** Kurir harus punya shift terbuka dan belum penuh (bawaan 1 pengiriman aktif). Alasan wajib untuk tarik/batalkan. [V]
- **[1.7]** Hanya uang tunai saat COD (aplikasi kurir tidak punya QRIS). [V]
- **[1.8]** Memegang kapabilitas, tetapi tidak punya orderQueue sehingga tidak ada layar antrean; tidak terverifikasi di UI. [D]
- **[1.9]** Refund > Rp 100.000 (bawaan REFUND_HQ_THRESHOLD) tertahan di antrean HQ sampai disetujui FINANCE/SUPER_ADMIN. [K] (Sama: refund besar tetap menunggu keputusan. [V])
- **[1.10]** Refund > Rp 100.000 (bawaan REFUND_HQ_THRESHOLD) tertahan di antrean HQ sampai disetujui FINANCE/SUPER_ADMIN. [K]
- **[1.11]** Refund > Rp 100.000 (bawaan REFUND_HQ_THRESHOLD) tertahan di antrean HQ sampai disetujui FINANCE/SUPER_ADMIN. [K] (Sama: > ambang masuk antrean; FINANCE memegang juga pemutus, tanpa cek pemohon sama dengan penyetuju. [V])

### 3.2 Kasir (penjualan konter) dan shift kasir

**Cakupan:** Terkunci/terhimpun mengikuti depot; shift kasir milik orang yang membukanya. [V]

| # | Aksi | Kat. | CUS | KD | STF | SPV | ASPV | FRA | HR | HO | SA | MGR | DIR | FIN | MKT | Bukti (kapabilitas / kode) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2.1 | Mencatat penjualan konter (tunai/QRIS/transfer) | Create | — | Bersyarat [2.1] | — | — | — | — | — | — | Ya | Bersyarat [2.2] | — | — | — | `walkInSale` · order.controller.ts walk-in |
| 2.2 | Membatalkan (void) penjualan konter | Delete | — | Bersyarat [2.3] | — | — | — | — | — | — | Bersyarat [2.3] | Bersyarat [2.3] | — | — | — | `walkInSale` · order.service.ts:1257 |
| 2.3 | Membuka dan menutup shift kasir | Submit | — | Bersyarat [2.4] | — | — | — | — | — | — | Ya | Bersyarat [2.5] | — | — | — | `cashierShift` · cashier-shift.controller.ts |

**Penjelasan sel Dibatasi / Bersyarat / Tidak terverifikasi / catatan:**

- **[2.1]** Wajib ada shift kasir terbuka; QRIS/Transfer aktif hanya bila depot sudah mengisi QRIS/rekening. [V]
- **[2.2]** Wajib ada shift kasir terbuka; QRIS/Transfer aktif hanya bila depot sudah mengisi QRIS/rekening. [V] (Sama dengan Kepala depot. [V])
- **[2.3]** Hanya penjualan konter pada shift terbuka milik pemanggil; alasan wajib. Setelah itu lewat refund. [V]
- **[2.4]** Hanya menutup shift sendiri; menutup shift orang lain butuh depotFinance. Selisih laci hanya dicatat, tanpa persetujuan. [V]
- **[2.5]** Boleh menutup shift yang ditinggalkan (depotFinance). [V]

### 3.3 Inventori, meteran, pengadaan

**Cakupan:** Terkunci/terhimpun mengikuti depot. [V]

| # | Aksi | Kat. | CUS | KD | STF | SPV | ASPV | FRA | HR | HO | SA | MGR | DIR | FIN | MKT | Bukti (kapabilitas / kode) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 3.1 | Melihat stok, pergerakan, transfer | View | — | Ya | — | Ya | Ya | — [3.1] | — | Ya | Ya | Ya | Ya | — | — | `inventoryRead` |
| 3.2 | Terima stok, sesuaikan, opname, titik pesan, harga jual per baris | Edit | — | Bersyarat [3.2] | — | — | — | — | — | — | Ya | Bersyarat [3.3] | — | — | — | `inventoryWrite` · inventory.service.ts |
| 3.3 | Kirim/terima/tarik kembali transfer stok antar depot | Submit | — | Ya | — | — | — | — | — | — | Ya | Ya | — | — | — | `inventoryWrite` · stock-transfer.service.ts |
| 3.4 | Menghapus baris stok | Delete | — | Bersyarat [3.4] | — | — | — | — | — | — | Bersyarat [3.4] | Bersyarat [3.4] | — | — | — | `inventoryWrite` |
| 3.5 | Mencatat meteran air pagi/sore | Create | — | Ya | Dibatasi [3.5] | — | — | — | — | — | Ya | Ya | — | — | — | `meterWrite` · meter.controller |
| 3.6 | Melihat meteran dan selisih | View | — | Ya | Ya | Ya | Ya | — | — | Ya | Ya | Ya | Ya | — | — | `meterRead` |
| 3.7 | Pesanan pembelian dan pemasok | Create | — | — | — | — | — | — | — | — | Ya | Ya | — | — | — | `procurement` · purchase-order.controller.ts:18 |

**Penjelasan sel Dibatasi / Bersyarat / Tidak terverifikasi / catatan:**

- **[3.1]** Waralaba tidak memegang inventoryRead; kolom "Hari habis" prakiraan jadi kosong. [D]
- **[3.2]** Opname langsung mengubah stok; selisih bernilai > Rp 100.000 (bawaan) memunculkan persetujuan MANAGER setelah kejadian. [V]
- **[3.3]** Opname langsung mengubah stok; selisih bernilai > Rp 100.000 (bawaan) memunculkan persetujuan MANAGER setelah kejadian. [V] (Sama; MANAGER memutus tetapi tidak boleh memutus yang ia ajukan sendiri. [V])
- **[3.4]** Hanya baris kosong yang belum pernah terjual. [V]
- **[3.5]** Kapabilitas ada; layar /dashboard/meter tidak ada di menu kurir. [D]

### 3.4 Retur galon

**Cakupan:** Per depot; Waralaba hanya depot miliknya (assertDepotOwnership). [V]

| # | Aksi | Kat. | CUS | KD | STF | SPV | ASPV | FRA | HR | HO | SA | MGR | DIR | FIN | MKT | Bukti (kapabilitas / kode) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 4.1 | Melihat retur dan galon keluar | View | — | Ya | — | Ya | Ya | Dibatasi [4.1] | — | Ya | Ya | Ya | Ya | — | — | `returnsRead` |
| 4.2 | Mencatat retur/galon keluar di depot, impor saldo galon | Create | — | Bersyarat [4.2] | — | — | — | — | — | — | Ya | Bersyarat [4.2] | — | — | — | `returnsWrite` · gallon-return.service.ts |
| 4.3 | Mencatat retur galon di pintu pelanggan (kurir) | Create | — | — | Bersyarat [4.3] | — | — | — | — | — | Ya | — | — | — | — | `courierReturn` |

**Penjelasan sel Dibatasi / Bersyarat / Tidak terverifikasi / catatan:**

- **[4.1]** Hanya baca, hanya depot miliknya. [V]
- **[4.2]** Retur melebihi saldo, galon rusak atau tanpa pelanggan memunculkan persetujuan MANAGER (di atas Rp 100.000). [V]
- **[4.3]** Nilai refund dihitung server dari tarif deposit depot. [V]

### 3.5 Setoran COD dan dompet kurir

**Cakupan:** Setoran dicatat per shift kurir. [V]

| # | Aksi | Kat. | CUS | KD | STF | SPV | ASPV | FRA | HR | HO | SA | MGR | DIR | FIN | MKT | Bukti (kapabilitas / kode) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 5.1 | Menyetor uang tunai COD akhir shift | Submit | — | — | Bersyarat [5.1] | — | — | — | — | — | Ya | — | — | — | — | `courierDeposit` · driver-settlement.controller.ts:26 |
| 5.2a | Membebankan selisih kurang setoran ke saldo kurir (sejak PR #664, 2026-10-14) | Approve | — | — | — | — | — | — | — | — | Ya | Ya | — | — | — | `approvals` · settlement.service.ts |
| 5.2 | Memverifikasi atau menyengketakan setoran | Approve | — | Bersyarat [5.2] | — | — | — | — | — | — | Ya | Ya | — | Dibatasi [5.3] | — | `courierSettle` · settlement.controller.ts |
| 5.3 | Melihat penghasilan, riwayat, menarik saldo kurir | Submit | — | — | Bersyarat [5.4] | — | — | — | — | — | Ya | — | — | — | — | `courierPayout` · courier-payout.controller.ts |
| 5.4 | Mengajukan klaim pengeluaran kurir | Create | — | — | Bersyarat [5.5] | — | — | — | — | — | Ya | — | — | — | — | `courierPayout` |
| 5.5 | Menyetujui/menolak klaim pengeluaran | Approve | — | — | — | — | — | — | — | — | Ya | Bersyarat [5.6] | — | Ya | — | `expenseApprove` · expense-approval.controller.ts |
| 5.6 | Mengatur aturan penghasilan kurir | Configure | — | — | — | — | — | — | — | — | Ya | — | — | Ya | — | `earningRules` · earning rules |

**Penjelasan sel Dibatasi / Bersyarat / Tidak terverifikasi / catatan:**

- **[5.1]** Shift harus sudah check-out; satu setoran per shift; tidak bisa diubah setelah kirim. [V]
- **[5.2]** Memverifikasi tanpa membebankan boleh oleh pemegang `courierSettle` (KD, MGR, FIN, SA). Membebankan selisih ke kurir kini hanya MANAGER/SUPER_ADMIN (baris 5.2a; 403 `SETTLEMENT_CHARGE_NEEDS_MANAGER`, sejak PR #664): kurir menyetor, manajer memverifikasi = orang kedua; tidak ada antrean persetujuan asinkron (COD_VARIANCE tetap tidak pernah dibuat). Pemeriksaan hanya bila selisih benar-benar kurang dan beban dicentang. Setoran SENGKETA (DISPUTED) dapat diputuskan ulang dengan catatan wajib (sejak PR #664). Surplus > Rp 5.000 wajib catatan. [V]
- **[5.3]** Memegang kapabilitas; tidak ada tautan menu ke layar Setoran. [D]
- **[5.4]** Hanya data sendiri; tarik saldo hanya ke rekening terverifikasi kantor pusat; minimum penarikan Rp50.000 (sejak PR #664; `MIN_WITHDRAWAL_IDR`, bawaan 50000, "Minimum penarikan Rp50.000."). [V]
- **[5.5]** Klaim <= Rp 50.000 dengan struk valid disetujui otomatis. [K]
- **[5.6]** Batas bawaan Rp 500.000; di atasnya hanya FINANCE/SUPER_ADMIN (MANAGER masih boleh menolak). [K]

### 3.6 Tutup buku

**Cakupan:** Per depot dan tanggal. [V]

| # | Aksi | Kat. | CUS | KD | STF | SPV | ASPV | FRA | HR | HO | SA | MGR | DIR | FIN | MKT | Bukti (kapabilitas / kode) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 6.1 | Menutup buku harian | Submit | — | Bersyarat [6.1] | — | — | — | — | — | Bersyarat [6.1] | Bersyarat [6.1] | Bersyarat [6.1] | Bersyarat [6.1] | — | — | `dailyClose` · daily-close.controller.ts |
| 6.2 | Membuka kembali buku harian/bulanan | Edit | — | — | — | — | — | — | — | Bersyarat [6.2] | Ya | — | — | — | — | `dailyCloseReopen` · daily-close.controller.ts:76; monthly-close.controller.ts:74 |

**Penjelasan sel Dibatasi / Bersyarat / Tidak terverifikasi / catatan:**

- **[6.1]** Ditolak bila masih ada shift kasir terbuka. Tidak mensyaratkan setoran COD terverifikasi. [V]
- **[6.2]** Tombol ada di /dashboard/reports (pilih depot). Layar tinjauan bulanan sebelumnya dibatasi depotFinance sehingga HO tidak sampai; sejak PR #664 (2026-10-14) layar dan menu memakai `dailyClose` (sama dengan server) dan tombol "Buka bulan" tampil untuk pemegang `dailyCloseReopen`, jadi HO kini dapat menjangkaunya. [V code] [D peramban]

### 3.7 Tracking dan pengantaran

**Cakupan:** Kurir hanya melihat tugasnya sendiri. [V]

| # | Aksi | Kat. | CUS | KD | STF | SPV | ASPV | FRA | HR | HO | SA | MGR | DIR | FIN | MKT | Bukti (kapabilitas / kode) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 7.1 | Melihat live tracking dan roster shift | View | — | Ya | — | Ya | Ya | — | — | Ya | Ya | Ya | Ya | — | — | `trackingRead` · delivery.controller GET |
| 7.2 | Menjalankan pengantaran (ambil, antar, bukti, gagal, jadwal ulang) | Submit | — | — | Ya | — | — | — | — | — | Ya | — | — | — | — | canUseCourierApp (roles.ts); controller /driver |
| 7.3 | Mengubah jadwal shift kurir | Edit | — | Ya | — | — | — | — | — | Ya | Ya | Ya | Ya | — | — | `driverRoster` · roster.controller.ts:22 |
| 7.4 | Mengirim pengumuman depot ke kurir | Create | — | Ya | — | — | — | — | — | — | Ya | Ya | — | — | — | `depotBroadcast` · broadcast.controller |
| 7.5 | Membaca pengumuman depot | View | — | Ya | Ya | — | — | — | — | — | Ya | Ya | — | — | — | `depotBroadcastRead` |

**Penjelasan sel Dibatasi / Bersyarat / Tidak terverifikasi / catatan:**

- (tidak ada sel khusus)

### 3.8 Pelanggan dan CRM

**Cakupan:** Direktori mengikuti cakupan depot; direktori pemasaran lintas depot. [V]

| # | Aksi | Kat. | CUS | KD | STF | SPV | ASPV | FRA | HR | HO | SA | MGR | DIR | FIN | MKT | Bukti (kapabilitas / kode) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 8.1 | Melihat pelanggan depot, CRM, follow-up | View | — | Ya | — | Ya | Ya | — | Dibatasi [8.1] | Ya | Ya | Ya | Ya | — | — | `depotCrm` |
| 8.2 | Impor pelanggan/alamat massal | Create | — | Ya | — | — | — | — | — | Ya | Ya | Ya | Ya | — | — | `depotCrmWrite` · maks 500 baris |
| 8.3 | Melihat direktori pelanggan pemasaran (segmen) | View | — | — | — | — | — | — | — | Ya | Ya | — | — | — | Ya | `customerDirectory` |
| 8.4 | Cek pelanggan berdasarkan nomor HP | View | — | — | — | — | — | — | Ya | Ya | Ya | Ya | Ya | — | Ya | `customerPhoneLookup` · sebelum mengubah peran akun |
| 8.5 | Cek nama pelanggan massal (reseller) | View | — | — | — | — | — | — | — | Ya | Ya | Ya | — | — | — | `customerNameLookup` |
| 8.6 | Melihat daftar reseller/agen | View | — | — | — | Ya | — | — | Dibatasi [8.2] | Ya | Ya | Ya | Ya | — | — | `resellerView` |
| 8.7 | Mengubah reseller/agen, impor | Edit | — | — | — | — | — | — | — | Ya | Ya | Ya | Ya | — | — | `resellerAdmin` |
| 8.8 | Impor riwayat penjualan depot | Create | — | — | — | — | — | — | — | Ya | Ya | Ya | Ya | — | — | `salesImportAdmin` |
| 8.9 | Mencatat dan menyelesaikan sengketa order | Edit | — | Bersyarat [8.3] | — | Bersyarat [8.4] | — | — | — | Bersyarat [8.3] | Ya | Ya | Bersyarat [8.3] | — | — | `depotDisputes` · dispute.controller.ts:46 |
| 8.10 | Mencatat dan menyelesaikan insiden depot | Edit | — | Ya | — | Dibatasi [8.5] | — | — | — | — | Ya | Ya | — | — | — | `incidents` · incident.controller.ts |
| 8.11 | Risiko churn dan prakiraan | View | — | — | — | — | — | — | — | Ya | Ya | Ya | Ya | — | Ya | `churn` |
| 8.12 | Prakiraan permintaan | View | — | Ya | — | Ya | Ya | Dibatasi [8.6] | — | Ya | Ya | Ya | Ya | — | — | `forecast` |

**Penjelasan sel Dibatasi / Bersyarat / Tidak terverifikasi / catatan:**

- **[8.1]** Hanya baca (tab Pelanggan di konsol HR). [V]
- **[8.2]** Hanya baca. [V]
- **[8.3]** Pilihan Refund ditolak server bila pemanggil tak punya refundIssue; sengketa tetap Terbuka. [V]
- **[8.4]** Pilihan Refund ditolak server bila pemanggil tak punya refundIssue; sengketa tetap Terbuka. [V] (Sama (SPV tidak punya refundIssue). [V])
- **[8.5]** Header kode menyebut SPV hanya baca, tetapi server memberi tulis (catat dan selesaikan). [B]
- **[8.6]** Hanya depot miliknya; tabel stok butuh inventoryRead. [D]

### 3.9 Promo, voucher, kampanye

**Cakupan:** Aturan promo Kepala depot dibatasi depotnya; kampanye depot dibatasi depot sendiri. [V]

| # | Aksi | Kat. | CUS | KD | STF | SPV | ASPV | FRA | HR | HO | SA | MGR | DIR | FIN | MKT | Bukti (kapabilitas / kode) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 9.1 | Melihat promo banner | View | — | Ya | — | — | — | — | — | Ya | Ya | Ya | Ya | — | Ya | `promotionRead` |
| 9.2 | Membuat/mengubah promo banner | Edit | — | — [9.1] | — | — | — | — | — | — | Ya | Ya | — | — | Ya | `promotionWrite` · promotion.controller.ts |
| 9.3 | Melihat voucher | View | — | — | — | — | — | — | — | Ya | Ya | Ya | Ya | — | Ya | `voucherRead` |
| 9.4 | Membuat voucher, memberi ke pelanggan | Create | — | — | — | — | — | — | — | — | Ya | Bersyarat [9.2] | — | — | Ya | `voucherWrite` · voucher.controller |
| 9.5 | Menyetujui permintaan voucher depot (RETIRED) | Approve | — | — | — | — | — | — | — | Tidak terverifikasi [9.3] | Tidak terverifikasi [9.3] | — | Tidak terverifikasi [9.3] | — | — | `voucherRequestDecide` · index.ts:416 |
| 9.6 | Melihat aturan promo otomatis | View | — | Ya | — | — | — | — | — | Ya | Ya | Ya | Ya | — | Ya | `promoRuleRead` |
| 9.7 | Membuat/ubah/hapus aturan promo otomatis | Edit | — | Dibatasi [9.4] | — | — | — | — | — | — | Ya | Dibatasi [9.5] | — | — | Bersyarat [9.6] | `promoRuleWrite` · promo-rule.controller.ts |
| 9.8 | Melihat kampanye broadcast | View | — | — | — | — | — | — | — | Ya | Ya | — | Ya | — | Ya | `campaignRead` |
| 9.9 | Membuat dan mengirim kampanye lintas depot | Create | — | — | — | — | — | — | — | — [9.7] | Ya | — | — [9.7] | — | Ya | `campaignWrite` · campaign.controller.ts |
| 9.10 | Kampanye ke pelanggan depot sendiri | Create | — | Dibatasi [9.8] | — | — | — | — | — | — | Ya | Dibatasi [9.9] | — | — | Ya | `depotCampaign` · POST /campaigns/depot |
| 9.11 | Melihat jangkauan audiens | View | — | — | — | — | — | — | — | Ya | Ya | — | Ya | — | Ya | `audienceReach` |

**Penjelasan sel Dibatasi / Bersyarat / Tidak terverifikasi / catatan:**

- **[9.1]** Diperbaiki sejak PR #664 (2026-10-14): tombol Promo baru/Edit/Hapus kini hanya tampil bagi pemegang `promotionWrite` (`canManagePromotions`); Kepala depot hanya membaca daftar. Server tetap menolak (403) bila dipaksa. [V]
- **[9.2]** Cakupan voucher buatan manajer (depot atau jaringan) belum terverifikasi. [K]
- **[9.3]** Alur permintaan voucher dihapus (CA-2-42); kapabilitas `voucherRequestDecide` ditandai RETIRED di komentar kode sejak PR #664 dan tinggal nama agar baris matriks tersimpan tetap valid. Tidak ada kontroler yang menegakkannya. [V]
- **[9.4]** Hanya aturan depot sendiri; aturan jaringan hanya terbaca. [V]
- **[9.5]** Hanya aturan depot dalam cakupannya. [V]
- **[9.6]** Aturan yang sudah dipakai tidak bisa dihapus, hanya dinonaktifkan. [V]
- **[9.7]** Tombol Buat kampanye/Re-engage tampil di /hq tetapi ditolak server. [B]
- **[9.8]** Segmen dikunci ke depot sendiri. [V]
- **[9.9]** Segmen dikunci ke depot dalam cakupannya. [V]

### 3.10 Loyalty, referral

**Cakupan:** Per program jaringan. [V]

| # | Aksi | Kat. | CUS | KD | STF | SPV | ASPV | FRA | HR | HO | SA | MGR | DIR | FIN | MKT | Bukti (kapabilitas / kode) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10.1 | Melihat angka program loyalty/referral | View | — | — | — | — | — | — | — | Ya | Ya | Ya | — | — | Ya | `loyaltyRead` |
| 10.2 | Menyesuaikan poin pelanggan manual | Edit | — | — | — | — | — | — | — | — | Ya | Ya | — | — | Ya | `loyaltyAdjust` |
| 10.3 | Kelola katalog hadiah | Configure | — | — | — | — | — | — | — | — | Ya | — | — | — | Ya | `rewardCatalog` |
| 10.4 | Menyerahkan hadiah tukar poin di konter | Submit | — | Dibatasi [10.1] | — | — | — | — | — | — | Ya | Dibatasi [10.1] | — | — | Ya | `rewardHandover` · reward.controller.ts:156 |
| 10.5 | Menukar poin, kode referral, voucher sendiri | Create | Ya | — | — | — | — | — | — | — | — | — | — | — | — | rute pelanggan |

**Penjelasan sel Dibatasi / Bersyarat / Tidak terverifikasi / catatan:**

- **[10.1]** Hanya penukaran yang berdepot sama atau tanpa depot. [V]

### 3.11 Depot, harga, katalog

**Cakupan:** Hanya depot yang berada dalam cakupan; Waralaba hanya miliknya. [V]

| # | Aksi | Kat. | CUS | KD | STF | SPV | ASPV | FRA | HR | HO | SA | MGR | DIR | FIN | MKT | Bukti (kapabilitas / kode) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 11.1 | Melihat data lengkap depot | View | — | Dibatasi [11.1] | — | — | — | Dibatasi [11.2] | — | Ya | Ya | Ya | Ya | — | — | `depotDirectory` |
| 11.2 | Membuat, mengubah, menangguhkan depot; jam buka; QRIS/rekening; harga dinamis | Edit | — | — | — | — | — | — | — | — [11.3] | Ya | Ya | — [11.3] | — | — | `depotAdmin` · depot.controller.ts:355,454 |
| 11.3 | Mengusulkan perubahan harga massal (Import Harga Depot) | Submit | — | — | — | — | — | — | — | — | Bersyarat [11.4] | Bersyarat [11.4] | — | — | — | `depotAdmin` · price-override.controller.ts |
| 11.4 | Memutus usulan harga depot | Approve | — | — | — | — | — | — | — | Bersyarat [11.5] | Bersyarat [11.5] | — | Bersyarat [11.5] | — | — | `priceOverrideDecide` · price-override.controller.ts:102 |
| 11.5 | Mengelola katalog produk (jaringan) | Edit | — | — | — | — | — | — | — | Ya | Ya | Bersyarat [11.6] | — | — | — | `catalogWrite` |
| 11.6 | Harga grosir (tier) dan langganan depot | Edit | — | — | — | — | — | — | — | — | Ya | Ya | — | — | — | `depotWholesale` · depotSubscriptions identik: MGR, SA |
| 11.7 | Target, huddle, serah terima shift, perawatan alat | Edit | — | Ya | — | Dibatasi [11.7] | — | — | — | Dibatasi [11.8] | Ya | Ya | Dibatasi [11.8] | — | — | `depotHuddle` · depotHandover, depotMaintenance, depotTargets |
| 11.8 | Membaca setelan dan nilai efektif | View | — | — | — | — | — | — | — | Ya | Ya | Ya | Ya | Ya | — | `settingsRead` |
| 11.9 | Mengubah setelan per depot | Configure | — | — | — | — | — | — | — | — | Ya | Dibatasi [11.9] | — | — | — | `depotAdmin` · settings.controller.ts class-level depotAdmin |
| 11.10 | Mengubah setelan global jaringan | Configure | — | — | — | — | — | — | — | — | Ya | — | — | — | — | `settingsGlobal` |
| 11.11 | Mengubah ambang auto-pass persetujuan | Configure | — | — | — | — | — | — | — | Tidak terverifikasi [11.10] | Ya | — | — | — | — | `approvalThresholdWrite` · setting-defs.ts:66 |

**Penjelasan sel Dibatasi / Bersyarat / Tidak terverifikasi / catatan:**

- **[11.1]** Hanya baca; tombol tulis disembunyikan. [V]
- **[11.2]** Hanya depot miliknya. [V]
- **[11.3]** Tombol Onboard/Edit/Tangguhkan tampil di /hq tetapi ditolak server. [B]
- **[11.4]** Menjadi usulan PENDING; tidak langsung berlaku. [V]
- **[11.5]** Pengusul tidak boleh memutus usulannya sendiri bila dampak di atas batas auto-pass. [V]
- **[11.6]** Berdampak ke seluruh jaringan, bukan hanya depot sendiri. [D]
- **[11.7]** Target (depotTargets) boleh; huddle/serah terima/perawatan tidak. [V]
- **[11.8]** Hanya Target (depotTargets). [V]
- **[11.9]** Hanya override depot; nilai berstatus global butuh SUPER_ADMIN. [V]
- **[11.10]** Memegang kapabilitas, tetapi layar setelan dikunci depotAdmin; praktis hanya SUPER_ADMIN. [V]

### 3.12 Persetujuan (approval)

**Cakupan:** Pemutus tidak boleh sama dengan pengaju. [V]

| # | Aksi | Kat. | CUS | KD | STF | SPV | ASPV | FRA | HR | HO | SA | MGR | DIR | FIN | MKT | Bukti (kapabilitas / kode) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 12.1 | Memutus antrean approval depot (opname, deposit, selisih galon) | Approve | — | — | — | — | — | — | — | — | Bersyarat [12.1] | Bersyarat [12.1] | — | — | — | `approvals` · approval.controller.ts:20 |
| 12.2 | Menolak atau menahan item approval | Reject | — | — | — | — | — | — | — | — | Bersyarat [12.2] | Bersyarat [12.2] | — | — | — | `approvals` |
| 12.3 | Memutus lamaran waralaba (setujui/tolak, ubah tahap) | Approve | — | — | — | — | — | — | — | Bersyarat [12.3] | Bersyarat [12.3] | — | Bersyarat [12.3] | — | — | `franchiseApplications` · franchise-application.controller.ts |
| 12.4 | Meninjau tanda penipuan (fraud) | Approve | — | — | — | — | — | — | — | Ya | Ya | — | Ya | — | — | `fraudReview` |
| 12.5 | Memutus refund yang tertahan (setujui/tolak) | Approve | — | — | — | — | — | — | — | — | Bersyarat [12.4] | — | — | Bersyarat [12.4] | — | `refundQueue` · payment.controller.ts:642,653 |

**Penjelasan sel Dibatasi / Bersyarat / Tidak terverifikasi / catatan:**

- **[12.1]** Pengaju tidak boleh memutus yang ia ajukan sendiri; item HELD kini ikut tampil di daftar bersama PENDING (sejak PR #664, 2026-10-14; sebelumnya hilang). [V]
- **[12.2]** Menolak wajib catatan alasan. [V]
- **[12.3]** Setujui tidak mewajibkan checklist lengkap; keputusan final; tidak membuat depot/akun otomatis. [V]
- **[12.4]** Tidak ada cek pemohon sama dengan penyetuju; FINANCE memegang refundIssue dan refundQueue. [V]

### 3.13 Keuangan, payout, refund, komisi

**Cakupan:** Jaringan; Waralaba hanya saldo sendiri. [V]

| # | Aksi | Kat. | CUS | KD | STF | SPV | ASPV | FRA | HR | HO | SA | MGR | DIR | FIN | MKT | Bukti (kapabilitas / kode) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 13.1 | Melihat antrean refund | View | — | — | — | — | — | — | — | Ya | Ya | — | Ya | Ya | — | `refundQueueRead` |
| 13.2 | Melihat rekonsiliasi/settlement jaringan | View | — | — | — | — | — | — | — | Ya | Ya | — | Ya | Tidak terverifikasi [13.1] | — | `settlementRead` |
| 13.3 | Melihat antrean payout dan penarikan | View | — | — | — | — | — | — | — | Ya | Ya | — | Ya | Tidak terverifikasi [13.2] | — | `hqPayoutRead` |
| 13.4 | Mengajukan rilis saldo waralaba, verifikasi rekening, tandai Lunas/Gagal | Submit | — | — | — | — | — | — | — | — | Ya | — | — | Tidak terverifikasi [13.3] | — | `hqPayout` · hq-payout.controller.ts |
| 13.5 | Menyetujui/menolak rilis saldo waralaba | Approve | — | — | — | — | — | — | — | — | Bersyarat [13.4] | — | Bersyarat [13.4] | — | — | `hqPayoutApprove` · hq-payout.controller.ts:140,152 |
| 13.6 | Melihat saldo dan menarik saldo sendiri (pemilik waralaba) | Submit | — | — | — | — | — | Bersyarat [13.5] | — | — | Ya | — | — | — | — | `payout` |
| 13.7 | Menerapkan skema komisi | Edit | — | — | — | — | — | — | — | — | Ya | — | — | Tidak terverifikasi [13.6] | — | `commissionRuns` |
| 13.8 | Melihat skema komisi | View | — | — | — | — | — | — | — | Ya | Ya | — | Ya | Ya | — | `commissionRead` |
| 13.9 | Pajak/template faktur | Configure | — | — | — | — | — | — | — | Ya | Ya | — | — | Ya | — | `taxSettings` |
| 13.10 | Buku kas depot, rekonsiliasi pembayaran, komisi kurir, tinjauan bulanan | View | — | — | — | Dibatasi [13.7] | — | — | — | — | Ya | Ya | Ya | Ya | — | `depotFinance` |

**Penjelasan sel Dibatasi / Bersyarat / Tidak terverifikasi / catatan:**

- **[13.1]** Halaman /hq/reconciliation dan /hq/payments memuat data dari layanan yang menolak FINANCE; galat izin penuh (terbukti dalam UAT 2026-10-14, kondisi `main` sebelum perbaikan). **[B]** Diperbaiki di cabang `fix/uat-g128-g149-g152` (609a497) lewat kapabilitas `dashboardFinance`, `orderReportsFinance`, `depotDirectoryFinance`, `returnsReadFinance`; belum di `main`, belum diuji ulang. Sel FIN tetap "Tidak terverifikasi" sampai uji ulang.
- **[13.2]** Halaman memuat dashboard/executive yang menolak FINANCE (pengamatan pra-perbaikan). **[B]** Di cabang: `dashboardFinance` (belum di `main`, belum diuji ulang).
- **[13.3]** Lihat catatan FINANCE di atas dan [13.1]. [D]
- **[13.4]** Bukan pengaju yang sama (ReleaseSelfApprovalError). [V]
- **[13.5]** Hanya ke rekening yang diverifikasi FINANCE; minimal Rp50.000 per penarikan (sejak PR #664); tanpa persetujuan, langsung berstatus Diproses. Halaman Payout pemilik kini menampilkan "Riwayat penarikan". [V]
- **[13.6]** Halaman memuat daftar depot yang menolak FINANCE (pengamatan pra-perbaikan). **[B]** Di cabang: `depotDirectoryFinance` hanya untuk daftar depot (belum di `main`, belum diuji ulang).
- **[13.7]** Diperbaiki sejak PR #664 (2026-10-14): menu Komisi kurir kini memakai `courierSettle` (KD, MGR, FIN, SA), Tinjauan bulanan memakai `dailyClose` (KD, MGR, HO, DIR, SA), dan Performa tim memakai `deliveryReports` (HO, MGR, SA), yaitu kapabilitas yang ditegakkan server. Dengan demikian SPV tidak lagi melihat ketiganya. Buku kas boleh dicatat/dibalik (`depotFinance`). [V code]

### 3.14 HR, payroll, cuti, kasbon

**Cakupan:** Manajer terbatas depotnya; HR jaringan. [V]

| # | Aksi | Kat. | CUS | KD | STF | SPV | ASPV | FRA | HR | HO | SA | MGR | DIR | FIN | MKT | Bukti (kapabilitas / kode) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 14.1 | Melihat konsol HR | View | — | — | — | Dibatasi [14.1] | Dibatasi [14.1] | — | Ya | Ya | Ya | Dibatasi [14.2] | Ya | Ya | — | `hrView` · hr layout gate |
| 14.2 | Mengelola karyawan, wajah, absensi, setelan gaji | Edit | — | — | — | — | — | — | Ya | Bersyarat [14.3] | Ya | — | Bersyarat [14.3] | — | — | `hrAdmin` |
| 14.3 | Membuat/menyetujui/membayar payroll, tunjangan | Approve | — | — | — | — | — | — | Bersyarat [14.4] | — | Bersyarat [14.4] | — | — | Bersyarat [14.4] | — | `hrPayroll` · payroll.controller.ts |
| 14.3a | Membatalkan persetujuan payroll (APPROVED → DRAFT, alasan wajib, tidak bisa setelah PAID; sejak PR #664, 2026-10-14) | Reject | — | — | — | — | — | — | — | — | Ya | — | — | — | — | `hrPayroll` + cek peran SUPER_ADMIN di payroll.service.ts (`unapprove`) |
| 14.4 | Cuti tahap 1 (atasan) | Approve | — | — | — | — | — | — | Bersyarat [14.5] | — | Bersyarat [14.5] | Bersyarat [14.6] | — | — | — | `leaveApprove` · leave.controller.ts:102 |
| 14.5 | Cuti tahap 2 (HR) | Approve | — | — | — | — | — | — | Bersyarat [14.7] | Dibatasi [14.8] | Ya | — | Dibatasi [14.8] | — | — | `hrAdmin` · leave.controller.ts hr-decision |
| 14.6 | Menolak cuti | Reject | — | — | — | — | — | — | Bersyarat [14.9] | — | Bersyarat [14.9] | Bersyarat [14.9] | — | — | — | `leaveApprove` |
| 14.7 | Memutus kasbon | Approve | — | — | — | — | Bersyarat [14.10] | — | Bersyarat [14.11] | — | Bersyarat [14.12] | Bersyarat [14.12] | — | — | — | `kasbonApprove` · loan-request.controller.ts |
| 14.8 | Menolak kasbon | Reject | — | — | — | — | Bersyarat [14.13] | — | Bersyarat [14.13] | — | Bersyarat [14.13] | Bersyarat [14.13] | — | — | — | `kasbonApprove` |
| 14.9 | Merencanakan/menyetujui peminjaman karyawan lintas depot | Approve | — | — | — | — | — | — | Bersyarat [14.14] | Bersyarat [14.14] | Bersyarat [14.14] | — | Bersyarat [14.14] | — | — | `employeeAssign` |
| 14.10 | Mengajukan permintaan pinjam karyawan | Create | — | — | — | Bersyarat [14.15] | — | — | — | — | Ya | Bersyarat [14.15] | — | — | — | `employeeAssignRequest` · index.ts:360 |
| 14.11 | Absen wajah, slip gaji, cuti, kasbon milik sendiri | Submit | — | Ya | Ya | Ya | Ya | — [14.16] | Tidak terverifikasi [14.17] | Tidak terverifikasi [14.17] | Ya | Tidak terverifikasi [14.18] | Tidak terverifikasi [14.18] | Tidak terverifikasi [14.18] | Tidak terverifikasi [14.18] | canPunchAttendance (roles.ts) |

**Penjelasan sel Dibatasi / Bersyarat / Tidak terverifikasi / catatan:**

- **[14.1]** Hanya depot dalam cakupan. [V]
- **[14.2]** Hanya depotnya. [V]
- **[14.3]** Peran MANAGER tidak boleh diberikan HO; HR boleh. [V]
- **[14.4]** Slip hanya bisa dibuat setelah bulan berakhir. Sejak PR #664 (2026-10-14): Setujui ditolak bila penekannya adalah pembuat slip ("Slip ini dibuat oleh akun Anda sendiri; persetujuan harus dari orang lain (atau Super Admin)."); SUPER_ADMIN dikecualikan (agar meja HR satu orang tidak terkunci); slip tanpa pembuat tercatat tidak diblokir. Tandai Dibayar tidak punya pemeriksaan pelaku, jadi penyetuju boleh menandai dibayar. Batal persetujuan (baris 14.3a) hanya SUPER_ADMIN; HR/FINANCE yang memegang `hrPayroll` ditolak: "Hanya Super Admin yang bisa membatalkan persetujuan payroll." [V]
- **[14.5]** Tahap 2 harus orang lain dari pemutus tahap 1. [V]
- **[14.6]** Hanya depot dalam cakupan; tidak untuk cuti sendiri. [V]
- **[14.7]** Harus akun lain dari pemutus tahap 1. [V]
- **[14.8]** Server mengizinkan, tetapi layar hanya menampilkan tombol untuk pemegang leaveApprove. [V]
- **[14.9]** Catatan alasan wajib. [V]
- **[14.10]** Bila depot punya asisten supervisor, hanya dia yang boleh; yang lain mendapat penolakan. Tidak boleh memutus kasbon sendiri. Sejak PR #664 (2026-10-14): pengajuan kasbon maksimal 1x gaji pokok sebulan (gaji harian x 26; tanpa gaji pokok ditolak) dan pengajuan yang tidak diputuskan dalam 3 hari kerja (Senin–Jumat) kedaluwarsa menjadi Dibatalkan; memutus pengajuan kedaluwarsa ditolak 409. [V]
- **[14.11]** Hanya bila depot tanpa asisten supervisor (eskalasi). [V] (Sama seperti MANAGER. [V])
- **[14.12]** Hanya bila depot tanpa asisten supervisor (eskalasi). [V]
- **[14.13]** Alasan wajib; aturan pemutus sama. [V]
- **[14.14]** Berlaku hanya bila fitur DEPOT_ASSIGNMENT_ENABLED menyala (bawaan mati). [K]
- **[14.15]** Hanya usulan; fitur bawaan mati. [K]
- **[14.16]** Tidak punya data karyawan. [V]
- **[14.17]** Server hanya butuh tautan ke data karyawan; tidak ada menu ke /hr/me untuk peran ini. [D]
- **[14.18]** Pintu menu /hr/me tidak ditampilkan untuk MANAGER. [V]

### 3.15 Waralaba

**Cakupan:** Pemilik hanya depot dengan ownerId miliknya. [V]

| # | Aksi | Kat. | CUS | KD | STF | SPV | ASPV | FRA | HR | HO | SA | MGR | DIR | FIN | MKT | Bukti (kapabilitas / kode) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 15.1 | Melihat dasbor Waralabaku | View | — | — | — | — | — | Ya | — | — | Ya | — | — | — | — | `franchise` · dashboard.controller.ts:98 |
| 15.2 | Mengajukan diri sebagai mitra (form publik) | Create | Bersyarat [15.1] | — | — | — | — | — | — | — | — | — | — | — | — | franchise-application.controller.ts:84 |
| 15.3 | Mendaftar rekening pencairan | Submit | — | — | — | — | — | Ya | — | — | Ya | — | — | — | — | `payout` · bank-account.controller.ts |

**Penjelasan sel Dibatasi / Bersyarat / Tidak terverifikasi / catatan:**

- **[15.1]** Form publik tanpa login; 3 pengajuan per jam per sumber. [V]

### 3.16 Staf dan akses

**Cakupan:** Hanya HEAD_OFFICE dan SUPER_ADMIN yang dapat mengundang. [V]

| # | Aksi | Kat. | CUS | KD | STF | SPV | ASPV | FRA | HR | HO | SA | MGR | DIR | FIN | MKT | Bukti (kapabilitas / kode) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 16.1 | Melihat direktori staf | View | — | — | — | — | — | — | — | Ya | Ya | Dibatasi [16.1] | Ya | — | — | `staffDirectory` · account.controller.ts |
| 16.2 | Mengundang, memindahkan depot, mengaktif/nonaktifkan, impor staf | Manage access | — | — | — | — | — | — | — | Dibatasi [16.2] | Bersyarat [16.3] | — | — | — | — | `staffAdmin` · RESTRICTED_GRANTS index.ts:690 |
| 16.3 | Menghapus akun staf permanen | Delete | — | — | — | — | — | — | — | — | Bersyarat [16.4] | — | — | — | — | `staffDelete` · account.controller.ts:308 |
| 16.4 | Mengatur hierarki Depot, Asisten SPV, SPV, Manager dan hibah depot | Manage access | — | — | — | — | — | — | — | — | Ya | — | — | — | — | `hierarchyAdmin` · hierarchy.controller.ts:99 |
| 16.5 | Mengubah matriks peran dan hak akses | Manage access | — | — | — | — | — | — | — | — | Bersyarat [16.5] | — | — | — | — | `accessMatrixWrite` · access.controller.ts:107 |
| 16.6 | Memberi peran lewat edit jabatan karyawan | Manage access | — | — | — | — | — | — | Dibatasi [16.6] | Dibatasi [16.7] | Dibatasi [16.6] | — | Dibatasi [16.7] | — | — | `hrAdmin` · index.ts:655 |

**Penjelasan sel Dibatasi / Bersyarat / Tidak terverifikasi / catatan:**

- **[16.1]** Hanya depot dalam cakupan; banyak depot wajib menyebut depotId. [V]
- **[16.2]** Hanya peran yang tidak dibatasi: STAFF_DEPOT, KEPALA_DEPOT, ASPV, SPV, FRANCHISE_OWNER (5 peran; HEAD_OFFICE dikeluarkan sejak PR #664, 2026-10-14). Tidak boleh memberi MANAGER, DIREKTUR, FINANCE, HR, MARKETING, SUPER_ADMIN, HEAD_OFFICE. Sejak PR #664 menonaktifkan juga: mencabut semua refresh token (access token lama hidup ≤ 15 menit) dan ditolak untuk akun sendiri serta Super admin aktif terakhir. [V]
- **[16.3]** Hanya SUPER_ADMIN yang dapat memberi SUPER_ADMIN, DIREKTUR, FINANCE, HR, MARKETING, HEAD_OFFICE (yang terakhir sejak PR #664). Pesan: "Peran {ROLE} hanya boleh diberikan oleh {A atau B}." [V]
- **[16.4]** Tidak untuk akun sendiri atau super admin aktif terakhir. [V]
- **[16.5]** SUPER_ADMIN tidak boleh dilepas dari accessMatrixWrite (ditolak 400). [V]
- **[16.6]** Hanya STAFF_DEPOT, KEPALA_DEPOT, ASPV, SPV, MANAGER (HR_MANAGED_ROLES). [V]
- **[16.7]** Hanya STAFF_DEPOT, KEPALA_DEPOT, ASPV, SPV, MANAGER (HR_MANAGED_ROLES). [V] (Sama, tetapi MANAGER ditolak. [V])

### 3.17 Platform dan admin

**Cakupan:** Hanya SUPER_ADMIN secara bawaan, kecuali pintu /hq dan perkakas back-office. [V]

| # | Aksi | Kat. | CUS | KD | STF | SPV | ASPV | FRA | HR | HO | SA | MGR | DIR | FIN | MKT | Bukti (kapabilitas / kode) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 17.1 | Membuka konsol /hq (pintu) | View | — | — | — | — | — | — | — | Ya | Ya | — | Ya | Dibatasi [17.1] | — | `hqConsole` · roles.ts isHq |
| 17.2 | Perkakas back-office: tiket, insiden platform, SLA, laporan terjadwal, log ekspor, kesehatan | Edit | — | — | — | — | — | — | — | Dibatasi [17.2] | Ya | — | Dibatasi [17.2] | — | — | `hqBackOffice` |
| 17.3 | Feature flag, kunci API, webhook, retensi, keamanan, setelan sistem | Configure | — | — | — | — | — | — | — | — | Ya | — | — | — | — | `platformAdmin` · admin-service class-level |
| 17.4 | Menjalankan sapuan retensi (hapus permanen) | Delete | — | — | — | — | — | — | — | — | Bersyarat [17.3] | — | — | — | — | `platformAdmin` · retention.service.ts |

**Penjelasan sel Dibatasi / Bersyarat / Tidak terverifikasi / catatan:**

- **[17.1]** Hanya ± 9 layar yang gerbang kapabilitasnya terpenuhi. [V]
- **[17.2]** Layar Kebijakan SLA dikunci depotAdmin di menu; tidak terjangkau. [B]
- **[17.3]** Pratinjau disarankan dulu; data keuangan tidak pernah dihapus. [V]

### 3.18 Audit

**Cakupan:** Audit depot mengikuti cakupan; audit jaringan HQ. [V]

| # | Aksi | Kat. | CUS | KD | STF | SPV | ASPV | FRA | HR | HO | SA | MGR | DIR | FIN | MKT | Bukti (kapabilitas / kode) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 18.1 | Membaca jejak audit depot | View | — | Ya | — | Ya | Ya | — | — | Ya | Ya | Ya | Ya | — | — | `auditRead` · /dashboard/audit |
| 18.2 | Membaca dan mengekspor log audit jaringan | Export | — | — | — | — | — | — | — | Bersyarat [18.1] | Bersyarat [18.1] | — | Bersyarat [18.1] | — | — | `hqBackOffice` · /hq/audit |
| 18.3 | Membaca log audit HR | View | — | — | — | — | — | — | Ya | Ya | Ya | — | Ya | — | — | `hrAdmin` · /hr/audit |

**Penjelasan sel Dibatasi / Bersyarat / Tidak terverifikasi / catatan:**

- **[18.1]** Ekspor menolak bila jejak terlalu besar. Sejak PR #664 (2026-10-14) layar punya penyaring aksi (persis), tanggal dari/sampai, dan hasil (berhasil/ditolak), dan ekspor mengikuti penyaring yang sama; penyaring pelaku belum ada di layar. [V]

### 3.19 Laporan dan ekspor

**Cakupan:** Laporan depot mengikuti cakupan. [V]

| # | Aksi | Kat. | CUS | KD | STF | SPV | ASPV | FRA | HR | HO | SA | MGR | DIR | FIN | MKT | Bukti (kapabilitas / kode) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 19.1 | Dasbor eksekutif, analitik, laba rugi jaringan | View | — | — | — | Ya | Ya | — | — | Ya | Ya | Ya | Ya | — | — | `dashboard` |
| 19.2 | Laporan pesanan jaringan, ekspor pendapatan | Export | — | — | — | — | — | — | — | Ya | Ya | Ya | Ya | — | — | `orderReports` · /hq/reports/export XLSX/CSV/PDF |
| 19.3 | Laporan harian/mingguan satu depot, ekspor | Export | — | Ya | — | — | — | — | — | Ya | Ya | Ya | — | — | — | `orderReportsDepot` · /dashboard/reports |
| 19.4 | Laporan operasional depot | View | — | Ya | — | — | — | — | — | Ya | Ya | Ya | — | Ya | — | `depotOperationalReport` |
| 19.5 | Laporan SLA dan tim kurir | View | — | — | — | — [19.1] | — [19.1] | — | — | Ya | Ya | Ya | — | — | — | `deliveryReports` |
| 19.6 | Laporan HR (CSV/Excel/PDF) | Export | — | — | — | Ya | Ya | — | Ya | Ya | Ya | Ya | Ya | Ya | — | `hrView` · /hr/reports |
| 19.7 | Notifikasi operasional (feed) | View | — | Ya | Ya | Ya | — [19.2] | — | — | Ya | Ya | Ya | Ya | — | — | `opsNotif` |

**Penjelasan sel Dibatasi / Bersyarat / Tidak terverifikasi / catatan:**

- **[19.1]** Menu Performa tim tampil tetapi ditolak server. [B]
- **[19.2]** Tidak punya opsNotif. [V]

### 3.20 Data pribadi (UU PDP)

**Cakupan:** Pelanggan hanya data sendiri. [V]

| # | Aksi | Kat. | CUS | KD | STF | SPV | ASPV | FRA | HR | HO | SA | MGR | DIR | FIN | MKT | Bukti (kapabilitas / kode) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 20.1 | Meminta salinan data atau hapus akun sendiri | Create | Ya | — | — | — | — | — | — | — | — | — | — | — | — | account.controller.ts / data-subject |
| 20.2 | Memutus permintaan PDP (setujui ekspor/hapus, tolak) | Approve | — | — | — | — | — | — | — | Bersyarat [20.1] | Bersyarat [20.1] | — | — | — | — | `pdpRequests` · data-subject.controller.ts |

| 20.3 | Memaksa hapus akun pelanggan yang masih punya pesanan terbuka (dialog "Paksa hapus akun?"; sejak PR #664, 2026-10-14) | Approve | — | — | — | — | — | — | — | — | Ya | — | — | — | — | `pdpRequests` + cek peran SUPER_ADMIN di data-subject.controller.ts |

**Penjelasan sel Dibatasi / Bersyarat / Tidak terverifikasi / catatan:**

- **[20.1]** Penolakan wajib alasan; hapus permanen. Batas jawab 3x24 jam. Sejak PR #664 (2026-10-14): menyetujui hapus akun ditolak (409 `PDP_OPEN_ORDERS`) bila pelanggan masih punya pesanan terbuka; pemeriksaan gagal-tertutup. HEAD_OFFICE yang mengirim `force` ditolak 403 "Hanya Super Admin yang boleh memaksa penghapusan." [V]

### 3.21 Akun sendiri

**Cakupan:** Per akun. [V]

| # | Aksi | Kat. | CUS | KD | STF | SPV | ASPV | FRA | HR | HO | SA | MGR | DIR | FIN | MKT | Bukti (kapabilitas / kode) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 21.1 | Ubah profil, nomor HP, lihat dan akhiri sesi sendiri | Edit | Ya | Ya | Ya | Ya | Ya | Ya | Ya | Ya | Ya | Ya | Ya | Ya | Ya | rute @SelfScoped |
| 21.2 | Atur preferensi notifikasi sendiri | Configure | — | Ya | Ya | Ya | Ya | Ya | Ya | Ya | Ya | Ya | Ya | Ya | Ya | `ownNotifPrefs` · index.ts:520 |

**Penjelasan sel Dibatasi / Bersyarat / Tidak terverifikasi / catatan:**

- (tidak ada sel khusus)

## 4. Lampiran peran tambahan: MANAJER, DIREKTUR, FINANCE, MARKETING

Keempat peran ini ada di kode dan di kolom lampiran semua tabel di atas. Ringkasan khas:

### 4.1 MANAJER (`MANAGER`) — 68 kapabilitas (72 di cabang 609a497, belum di `main`)

- **Cakupan:** himpunan depot (bukan terkunci). Konsol: `/dashboard` di web; di aplikasi Ops ponsel mendarat di `/m/manager` (Beranda, Approval, Notif, Tim, Akun). **[V]**
- **Hanya MANAGER (di antara peran depot):** `approvals`, `procurement`, `depotAdmin`, `depotWholesale`, `depotSubscriptions`, `refundIssue` (bersama FINANCE), `expenseApprove` (bersama FINANCE), `leaveApprove` (bersama HR), `settingsRead`, `staffDirectory`, `catalogWrite`, `loyaltyAdjust`, `salesImportAdmin`, `resellerAdmin`. **[V]**
- **Tidak dipegang MANAGER:** `hierarchyAdmin`, `approvalThresholdWrite`, `priceOverrideDecide`, `refundQueue`, `staffAdmin`, `hqConsole`, `commissionRuns`, `hqPayout*`. Artinya MANAGER mengajukan tetapi tidak memutus refund besar, usulan harga, dan tidak mengubah ambang auto-pass. **[V]**
- **Pintu HQ:** MANAGER sengaja tidak masuk `/hq` walau memegang `dashboard`. **[V]** (`roles.ts` komentar `isHq`).
- **Absen wajah:** `canPunchAttendance` tidak mencakup MANAGER; menu "Absen saya" tidak tampil untuk MANAGER. **[V]**
- **Menu yang tampil tetapi data ditolak:** lihat 3.13 dan 3.19 (SPV/ASPV); untuk MANAGER tidak ada kasus [B] yang diketahui. **[D]**
- **Hanya MANAGER, SA yang melihat** antrean approval. Pengaju tidak boleh memutus approval yang ia ajukan sendiri (`ApprovalSelfDecideError`, approval.service.ts:138). **[V]**

### 4.2 DIREKTUR (`DIREKTUR`) — 46 kapabilitas (50 di cabang 609a497, belum di `main`)

- **Cakupan:** jaringan; pintu `/hq`. Peran pengawas: membaca hampir semua, memutus keputusan HQ (`priceOverrideDecide`, `franchiseApplications`, `fraudReview`; `voucherRequestDecide` berstatus RETIRED sejak PR #664, tidak ditegakkan), **menyetujui rilis payout** (`hqPayoutApprove`, bersama SA saja), menutup buku (`dailyClose`), mengelola HR (`hrAdmin`, `employeeAssign`). **[V]**
- **Sengaja tidak punya:** `staffAdmin` (tidak boleh membuat akun), `pdpRequests`, `approvalThresholdWrite`, `catalogWrite`, `dailyCloseReopen` (komentar kode: peran pengawasan membaca tanpa menulis). **[V]**
- **Peran DIREKTUR hanya dapat diberikan SUPER_ADMIN.** **[V]** (`RESTRICTED_GRANTS`).

### 4.3 FINANCE (`FINANCE`) — 21 kapabilitas (25 di cabang 609a497, belum di `main`)

- **Cakupan:** jaringan. Pintu `/hq` terbuka karena tujuh kapabilitasnya hanya punya layar di `/hq`: refund, payout, komisi, pajak, rekonsiliasi, template faktur. **[V]**
- **Hanya FINANCE + SA:** `refundQueue`, `hqPayout`, `commissionRuns`, `earningRules`. **[V]**
- **Risiko yang diketahui (bagian 5.1):** `/hq/payments`, `/hq/franchise`, `/hq/reconciliation`, `/hq/forms/commission` memuat data dari layanan yang menolak FINANCE (`dashboard`, `depotDirectory`) sehingga tampil galat izin penuh (terbukti dalam UAT 2026-10-14, kondisi `main`). **[B]** Alur payout Lunas/Gagal dan skema komisi untuk FINANCE **perlu diverifikasi di lingkungan nyata**. **[D]**
- **Diperbaiki di cabang (belum di `main`):** commit 609a497 pada `fix/uat-g128-g149-g152` menambah empat kapabilitas baca untuk FINANCE (`dashboardFinance`, `orderReportsFinance`, `depotDirectoryFinance`, `returnsReadFinance`; 21 menjadi 25). Pintu `/hq` tidak berubah. Belum diuji ulang. **[V code]**
- Pendaratan setelah masuk: layar `/hq` pertama yang boleh dibuka (bukan `/hr`). **[V]** (`consoleHome`, CA-2-17).

### 4.4 MARKETING (`MARKETING`) — 18 kapabilitas (tetap 18 di cabang)

- **Cakupan:** jaringan; **bukan** pintu `/hq` (keputusan pemilik 2 September 2026). Mendarat di `/dashboard/campaigns`. **[V]**
- Memegang: kampanye (baca/tulis), kampanye depot, promo, voucher, aturan promo, churn, loyalty (baca/sesuaikan), katalog hadiah, serah hadiah, direktori pelanggan, jangkauan audiens, cek pelanggan per HP. **[V]**
- Layar `/hq/loyalty`, `/hq/forms/*` yang diperuntukkan MARKETING berada di `/hq`, sedangkan MARKETING tidak punya pintu `/hq` — jalur layar ini **tidak terverifikasi**. **[D]**
- Peran MARKETING hanya dapat diberikan SUPER_ADMIN. **[V]**

## 5. Hal penting lintas modul

### 5.1 Daftar tombol/menu yang tampil tetapi ditolak server **[B]**

| Peran | Layar | Tampil | Server |
|---|---|---|---|
| Kepala depot | ~~Promo~~ (diperbaiki sejak PR #664, 2026-10-14) | Tombol Promo baru/Edit/Hapus kini hanya untuk pemegang `promotionWrite` | Server tetap 403 bila dipaksa |
| Kepala depot | ~~Pembayaran (tab)~~ (diperbaiki sejak PR #664) | Tab kini hanya untuk pemegang `depotAdmin` (MGR/SA); judul gerbang "Akses terbatas" | Halaman tetap menolak selain `depotAdmin` |
| Kepala depot | Sengketa order, Huddle, Serah terima, Perawatan | Teks gerbang kini "Akses terbatas" (sebelumnya "Khusus Manajer depot" yang menyesatkan; diubah sejak PR #664) | Siapa yang masuk tetap ditentukan kapabilitas |
| Waralaba | Menu ponsel "Antrean", Pencarian | Tampil | Kosong/ditolak |
| SPV / ASPV | ~~Performa tim, Komisi kurir, Tinjauan bulanan~~ (diperbaiki sejak PR #664, 2026-10-14) | Menu kini memakai `deliveryReports`, `courierSettle`, `dailyClose`, yang ditegakkan server, sehingga tidak tampil bagi SPV/ASPV | Server tetap menolak |
| HO / DIR | Onboard/Edit/Tangguhkan depot; Buat kampanye; Re-engage churn; Beri poin; banner promo | Tombol tampil | 403 |
| FINANCE | /hq/payments, /hq/reconciliation, /hq/franchise, formulir skema komisi | Layar tampil (pintu `/hq` terbuka) | Galat izin penuh pada `main` (UAT 2026-10-14). Diperbaiki di cabang `fix/uat-g128-g149-g152` (609a497) dengan empat kapabilitas baca baru; belum di `main`, belum diuji ulang |
| HO / DIR | Ajukan rilis, Verifikasi rekening, Lunas/Gagal, Setujui/Tolak refund, Terapkan skema komisi | Tombol tampil | 403 (butuh FINANCE/SA) |
| HR | Opsi peran MANAGER pada form karyawan untuk HO/DIR | Tampil | Ditolak |
| HO / DIR | Kebijakan SLA | Tidak di rel (gerbang `depotAdmin`) | Server memakai `hqBackOffice` (HO/DIR boleh) — layar tak terjangkau |
| Semua staf | "PIN persetujuan", "Perangkat masuk", "Data akun", "Ubah PIN" | Baris tampil | Tidak berfungsi (tanpa aksi) |

### 5.2 Maker-checker (pengaju ≠ pemutus)

| Alur | Pengaju | Pemutus | Dipaksa teknis? | Bukti |
|---|---|---|---|---|
| Approval depot | siapa pun yang memicu | MANAGER, SA | Ya (`ApprovalSelfDecideError`) | approval.service.ts:138 **[V]** |
| Rilis saldo waralaba (HQ) | FINANCE, SA | DIREKTUR, SA | Ya (`ReleaseSelfApprovalError`) | hq-release.service.ts:93 **[V]** |
| Refund besar | FINANCE, MANAGER, SA | FINANCE, SA | **Tidak**: tidak ada cek pemohon ≠ penyetuju; FINANCE dan SA memegang keduanya. Pemohon dicatat di `refundRequestedBy` dan ditampilkan di `/hq/refunds` (#665), tetapi `approveRefund` tidak membandingkannya | payment.service.ts `approveRefund` **[V]** |
| Usulan harga depot | MANAGER, SA | HO, DIR, SA | Sebagian: pengusul tak boleh memutus bila dampak di atas ambang auto-pass | price-override.service.ts **[V]** |
| Cuti | karyawan | MANAGER/HR (tahap 1), HR/HO/DIR/SA (tahap 2) | Ya: tahap 2 ≠ tahap 1; tak boleh memutus cuti sendiri | leave.service.ts **[V]** |
| Kasbon | karyawan | ASPV (bila ada), MANAGER/HR/SA bila tidak | Ya: tak boleh memutus sendiri; bila depot punya ASPV hanya dia. Sejak PR #664: maks 1x gaji pokok, kedaluwarsa 3 hari kerja | loan-request.service.ts **[V]** |
| Payroll (Setujui) | HR/FINANCE/SA (pembuat slip) | HR/FINANCE/SA selain pembuat | **Sebagian, sejak PR #664 (2026-10-14)**: pembuat slip tak boleh menyetujui, SUPER_ADMIN dikecualikan; Tandai Dibayar tanpa cek pelaku; batal persetujuan hanya SUPER_ADMIN sebelum PAID | payroll.service.ts **[V]** |
| Verifikasi setoran COD | kurir | KD, MGR, FIN, SA (verifikasi); MGR, SA (membebankan selisih) | Beban selisih ke kurir dipaksa lewat kapabilitas `approvals` sejak PR #664 (bukan antrean persetujuan); kurir menyetor, manajer memverifikasi | settlement.service.ts **[V]** |
| Hapus akun pelanggan (PDP) | pelanggan | HO, SA | Pesanan terbuka menolak; hanya SA boleh memaksa (sejak PR #664) | data-subject.controller.ts **[V]** |
| Permintaan voucher depot | — | — | Alur dihapus (2026-09-04); `voucherRequestDecide` RETIRED (komentar kode, sejak PR #664), tinggal nama | promo.module.ts **[V]** |

### 5.3 Siapa boleh memberi peran apa (`canGrantRole`)

| Peran yang diberikan | Boleh diberikan oleh | Bukti |
|---|---|---|
| STAFF_DEPOT, KEPALA_DEPOT, ASSISTANT_SUPERVISOR, SUPERVISOR, FRANCHISE_OWNER | Pemegang `staffAdmin` (HEAD_OFFICE, SUPER_ADMIN) | tak terdaftar di `RESTRICTED_GRANTS` **[V]** |
| HEAD_OFFICE | SUPER_ADMIN saja (sejak PR #664, 2026-10-14) | `RESTRICTED_GRANTS` `HEAD_OFFICE: ['SUPER_ADMIN']` **[V]** |
| MANAGER | SUPER_ADMIN atau HR (lewat data karyawan) | `RESTRICTED_GRANTS` **[V]** |
| DIREKTUR, FINANCE, HR, MARKETING | SUPER_ADMIN saja | **[V]** |
| SUPER_ADMIN | SUPER_ADMIN saja | **[V]** |
| CUSTOMER | Tidak ada (bukan peran staf) | **[V]** |

Catatan: keputusan pemilik 2026-10-14: HEAD_OFFICE tidak boleh membuat HEAD_OFFICE lain (memberi peran ini sama dengan menyerahkan `staffAdmin`); sebelumnya dapat (temuan H). Akibatnya Head office hanya boleh memberi 5 peran (STAFF_DEPOT, KEPALA_DEPOT, ASSISTANT_SUPERVISOR, SUPERVISOR, FRANCHISE_OWNER) dan formulir undang di web hanya menawarkan kelima peran itu (`grantableRoles`). **[V]** Impor staf massal hanya menerima STAFF_DEPOT dan KEPALA_DEPOT (`STAFF_IMPORT_ROLES`). **[V]**

### 5.4 Rantai keputusan uang (ringkas)

- **Refund:** MANAGER/FINANCE/SA mulai → bila nominal ≤ Rp 100.000 (bawaan) langsung dieksekusi; bila lebih, status tetap Lunas dengan persetujuan menunggu → FINANCE/SA putuskan. **[V/K]**
- **Penarikan pemilik waralaba (dan kurir):** minimal Rp50.000 (sejak PR #664); langsung Diproses (saldo dipotong) tanpa persetujuan HQ → FINANCE/SA tandai Lunas atau Gagal (saldo kembali). **[V]**
- **Rilis oleh HQ:** FINANCE/SA ajukan seluruh saldo → DIREKTUR/SA setujui (beda akun) → penarikan Diproses → FINANCE/SA tandai. **[V]**

## 6. Tabel lengkap 106 kapabilitas × 13 peran (kondisi `main`)

Dibangkitkan dari `CAPABILITIES` di `packages/access/src/index.ts` oleh skrip (bukan disalin manual), lalu dibandingkan dengan tabel temuan K: **0 selisih**. ✓ = dipegang secara bawaan; · = tidak. SUPER_ADMIN ✓ untuk semua karena `can()`. Kolom fungsi adalah ringkasan penulis; bila bertentangan, kode yang berlaku.

| # | Kapabilitas | Fungsi | CUS | STF | KD | ASPV | SPV | MGR | DIR | FRA | HO | FIN | HR | MKT | SA | Jml peran |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `dashboard` | Dasbor eksekutif/operasi | · | · | · | ✓ | ✓ | ✓ | ✓ | · | ✓ | · | · | · | ✓ | 6 |
| 2 | `orderQueue` | Antrean pesanan staf (baca lintas pelanggan) | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | · | · | · | ✓ | 8 |
| 3 | `walkInSale` | Catat penjualan konter | · | · | ✓ | · | · | ✓ | · | · | · | · | · | · | ✓ | 3 |
| 4 | `cashierShift` | Buka/tutup shift kasir | · | · | ✓ | · | · | ✓ | · | · | · | · | · | · | ✓ | 3 |
| 5 | `inventoryRead` | Baca stok | · | · | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | · | · | · | ✓ | 7 |
| 6 | `inventoryWrite` | Tulis stok (terima, sesuaikan, opname, transfer) | · | · | ✓ | · | · | ✓ | · | · | · | · | · | · | ✓ | 3 |
| 7 | `meterWrite` | Catat meteran air | · | ✓ | ✓ | · | · | ✓ | · | · | · | · | · | · | ✓ | 4 |
| 8 | `meterRead` | Baca meteran air | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | · | · | · | ✓ | 8 |
| 9 | `returnsRead` | Baca retur galon | · | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | 8 |
| 10 | `returnsWrite` | Tulis retur galon | · | · | ✓ | · | · | ✓ | · | · | · | · | · | · | ✓ | 3 |
| 11 | `campaignRead` | Baca kampanye broadcast | · | · | · | · | · | · | ✓ | · | ✓ | · | · | ✓ | ✓ | 4 |
| 12 | `campaignWrite` | Buat/kirim kampanye lintas depot | · | · | · | · | · | · | · | · | · | · | · | ✓ | ✓ | 2 |
| 13 | `depotCampaign` | Kampanye ke pelanggan depot sendiri | · | · | ✓ | · | · | ✓ | · | · | · | · | · | ✓ | ✓ | 4 |
| 14 | `promotionRead` | Baca promo banner | · | · | ✓ | · | · | ✓ | ✓ | · | ✓ | · | · | ✓ | ✓ | 6 |
| 15 | `promotionWrite` | Tulis promo banner | · | · | · | · | · | ✓ | · | · | · | · | · | ✓ | ✓ | 3 |
| 16 | `voucherRead` | Baca voucher | · | · | · | · | · | ✓ | ✓ | · | ✓ | · | · | ✓ | ✓ | 5 |
| 17 | `voucherWrite` | Tulis voucher | · | · | · | · | · | ✓ | · | · | · | · | · | ✓ | ✓ | 3 |
| 18 | `promoRuleRead` | Baca aturan promo otomatis | · | · | ✓ | · | · | ✓ | ✓ | · | ✓ | · | · | ✓ | ✓ | 6 |
| 19 | `promoRuleWrite` | Tulis aturan promo otomatis | · | · | ✓ | · | · | ✓ | · | · | · | · | · | ✓ | ✓ | 4 |
| 20 | `depotAdmin` | Admin depot (buat/ubah/tangguhkan, harga dinamis, setelan depot) | · | · | · | · | · | ✓ | · | · | · | · | · | · | ✓ | 2 |
| 21 | `franchise` | Dasbor pemilik waralaba | · | · | · | · | · | · | · | ✓ | · | · | · | · | ✓ | 2 |
| 22 | `payout` | Saldo dan penarikan pemilik waralaba | · | · | · | · | · | · | · | ✓ | · | · | · | · | ✓ | 2 |
| 23 | `staffAdmin` | Undang/kelola akun staf | · | · | · | · | · | · | · | · | ✓ | · | · | · | ✓ | 2 |
| 24 | `staffDelete` | Hapus akun staf permanen | · | · | · | · | · | · | · | · | · | · | · | · | ✓ | 1 |
| 25 | `dailyClose` | Tutup buku harian | · | · | ✓ | · | · | ✓ | ✓ | · | ✓ | · | · | · | ✓ | 5 |
| 26 | `dailyCloseReopen` | Buka kembali buku yang ditutup | · | · | · | · | · | · | · | · | ✓ | · | · | · | ✓ | 2 |
| 27 | `hierarchyAdmin` | Atur hierarki pembinaan dan hibah depot | · | · | · | · | · | · | · | · | · | · | · | · | ✓ | 1 |
| 28 | `driverRoster` | Roster/jadwal shift kurir | · | · | ✓ | · | · | ✓ | ✓ | · | ✓ | · | · | · | ✓ | 5 |
| 29 | `opsNotif` | Feed notifikasi operasional | · | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | ✓ | · | · | · | ✓ | 7 |
| 30 | `tracking` | Dispatch: tugaskan/tarik/batalkan pengiriman | · | · | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | ✓ | 5 |
| 31 | `trackingRead` | Baca live tracking dan roster | · | · | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | · | · | · | ✓ | 7 |
| 32 | `forecast` | Prakiraan permintaan | · | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | 8 |
| 33 | `churn` | Risiko churn | · | · | · | · | · | ✓ | ✓ | · | ✓ | · | · | ✓ | ✓ | 5 |
| 34 | `paymentSettle` | Konfirmasi pembayaran | · | ✓ | ✓ | · | · | ✓ | · | · | · | ✓ | · | · | ✓ | 5 |
| 35 | `paymentRead` | Baca pembayaran pesanan | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | · | · | ✓ | 9 |
| 36 | `courierPayout` | Dompet dan klaim kurir (data sendiri) | · | ✓ | · | · | · | · | · | · | · | · | · | · | ✓ | 2 |
| 37 | `courierSettle` | Verifikasi setoran COD kurir | · | · | ✓ | · | · | ✓ | · | · | · | ✓ | · | · | ✓ | 4 |
| 38 | `courierDeposit` | Setor uang COD (kurir) | · | ✓ | · | · | · | · | · | · | · | · | · | · | ✓ | 2 |
| 39 | `expenseApprove` | Putuskan klaim pengeluaran kurir | · | · | · | · | · | ✓ | · | · | · | ✓ | · | · | ✓ | 3 |
| 40 | `depotBroadcast` | Kirim pengumuman depot ke kurir | · | · | ✓ | · | · | ✓ | · | · | · | · | · | · | ✓ | 3 |
| 41 | `depotBroadcastRead` | Baca pengumuman depot | · | ✓ | ✓ | · | · | ✓ | · | · | · | · | · | · | ✓ | 4 |
| 42 | `courierReturn` | Catat retur galon di pintu pelanggan | · | ✓ | · | · | · | · | · | · | · | · | · | · | ✓ | 2 |
| 43 | `depotCrm` | Baca CRM/pelanggan depot | · | · | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | · | ✓ | · | ✓ | 8 |
| 44 | `depotCrmWrite` | Impor pelanggan depot | · | · | ✓ | · | · | ✓ | ✓ | · | ✓ | · | · | · | ✓ | 5 |
| 45 | `resellerView` | Baca reseller/agen | · | · | · | · | ✓ | ✓ | ✓ | · | ✓ | · | ✓ | · | ✓ | 6 |
| 46 | `resellerAdmin` | Ubah reseller/agen | · | · | · | · | · | ✓ | ✓ | · | ✓ | · | · | · | ✓ | 4 |
| 47 | `salesImportAdmin` | Impor riwayat penjualan | · | · | · | · | · | ✓ | ✓ | · | ✓ | · | · | · | ✓ | 4 |
| 48 | `incidents` | Insiden depot (catat, baca, selesaikan) | · | · | ✓ | · | ✓ | ✓ | · | · | · | · | · | · | ✓ | 4 |
| 49 | `auditRead` | Baca jejak audit depot | · | · | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | · | · | · | ✓ | 7 |
| 50 | `procurement` | Pesanan pembelian dan pemasok | · | · | · | · | · | ✓ | · | · | · | · | · | · | ✓ | 2 |
| 51 | `approvals` | Antrean approval depot | · | · | · | · | · | ✓ | · | · | · | · | · | · | ✓ | 2 |
| 52 | `approvalThresholdWrite` | Ubah ambang auto-pass approval | · | · | · | · | · | · | · | · | ✓ | · | · | · | ✓ | 2 |
| 53 | `depotFinance` | Buku kas, rekonsiliasi, tinjauan bulanan | · | · | · | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ✓ | 5 |
| 54 | `depotHuddle` | Huddle mingguan | · | · | ✓ | · | · | ✓ | · | · | · | · | · | · | ✓ | 3 |
| 55 | `depotHandover` | Serah terima shift | · | · | ✓ | · | · | ✓ | · | · | · | · | · | · | ✓ | 3 |
| 56 | `depotMaintenance` | Perawatan alat | · | · | ✓ | · | · | ✓ | · | · | · | · | · | · | ✓ | 3 |
| 57 | `depotTargets` | Target depot | · | · | · | · | ✓ | ✓ | ✓ | · | ✓ | · | · | · | ✓ | 5 |
| 58 | `depotWholesale` | Harga grosir | · | · | · | · | · | ✓ | · | · | · | · | · | · | ✓ | 2 |
| 59 | `depotSubscriptions` | Langganan depot | · | · | · | · | · | ✓ | · | · | · | · | · | · | ✓ | 2 |
| 60 | `depotDisputes` | Sengketa order | · | · | ✓ | · | ✓ | ✓ | ✓ | · | ✓ | · | · | · | ✓ | 6 |
| 61 | `hrAdmin` | Kelola karyawan, absensi, setelan gaji | · | · | · | · | · | · | ✓ | · | ✓ | · | ✓ | · | ✓ | 4 |
| 62 | `employeeAssign` | Rencana/putuskan penugasan lintas depot | · | · | · | · | · | · | ✓ | · | ✓ | · | ✓ | · | ✓ | 4 |
| 63 | `employeeAssignRequest` | Usul pinjam karyawan | · | · | · | · | ✓ | ✓ | · | · | · | · | · | · | ✓ | 3 |
| 64 | `hrPayroll` | Payroll dan tunjangan | · | · | · | · | · | · | · | · | · | ✓ | ✓ | · | ✓ | 3 |
| 65 | `leaveApprove` | Cuti tahap 1 | · | · | · | · | · | ✓ | · | · | · | · | ✓ | · | ✓ | 3 |
| 66 | `kasbonApprove` | Putuskan kasbon | · | · | · | ✓ | · | ✓ | · | · | · | · | ✓ | · | ✓ | 4 |
| 67 | `hrView` | Baca konsol HR | · | · | · | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | ✓ | 8 |
| 68 | `rewardHandover` | Serahkan hadiah tukar poin | · | · | ✓ | · | · | ✓ | · | · | · | · | · | ✓ | ✓ | 4 |
| 69 | `pdpRequests` | Putuskan permintaan UU PDP | · | · | · | · | · | · | · | · | ✓ | · | · | · | ✓ | 2 |
| 70 | `priceOverrideDecide` | Putuskan usulan harga depot | · | · | · | · | · | · | ✓ | · | ✓ | · | · | · | ✓ | 3 |
| 71 | `franchiseApplications` | Putuskan lamaran waralaba | · | · | · | · | · | · | ✓ | · | ✓ | · | · | · | ✓ | 3 |
| 72 | `voucherRequestDecide` | Putuskan permintaan voucher (alur dihapus; RETIRED sejak PR #664) | · | · | · | · | · | · | ✓ | · | ✓ | · | · | · | ✓ | 3 |
| 73 | `fraudReview` | Tinjau/blokir/lepas tanda fraud | · | · | · | · | · | · | ✓ | · | ✓ | · | · | · | ✓ | 3 |
| 74 | `refundIssue` | Mulai refund | · | · | · | · | · | ✓ | · | · | · | ✓ | · | · | ✓ | 3 |
| 75 | `refundQueue` | Putuskan refund tertahan | · | · | · | · | · | · | · | · | · | ✓ | · | · | ✓ | 2 |
| 76 | `settlementRead` | Baca settlement/rekonsiliasi | · | · | · | · | · | · | ✓ | · | ✓ | ✓ | · | · | ✓ | 4 |
| 77 | `hqPayout` | Ajukan rilis, verifikasi rekening, tandai Lunas/Gagal | · | · | · | · | · | · | · | · | · | ✓ | · | · | ✓ | 2 |
| 78 | `hqPayoutApprove` | Setujui/tolak rilis saldo | · | · | · | · | · | · | ✓ | · | · | · | · | · | ✓ | 2 |
| 79 | `earningRules` | Aturan penghasilan kurir | · | · | · | · | · | · | · | · | · | ✓ | · | · | ✓ | 2 |
| 80 | `settingsGlobal` | Tulis setelan global | · | · | · | · | · | · | · | · | · | · | · | · | ✓ | 1 |
| 81 | `settingsRead` | Baca setelan | · | · | · | · | · | ✓ | ✓ | · | ✓ | ✓ | · | · | ✓ | 5 |
| 82 | `accessMatrixWrite` | Ubah matriks hak akses | · | · | · | · | · | · | · | · | · | · | · | · | ✓ | 1 |
| 83 | `staffDirectory` | Baca direktori staf | · | · | · | · | · | ✓ | ✓ | · | ✓ | · | · | · | ✓ | 4 |
| 84 | `depotDirectory` | Baca data lengkap depot | · | · | ✓ | · | · | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | 6 |
| 85 | `hqConsole` | Pintu konsol /hq | · | · | · | · | · | · | ✓ | · | ✓ | ✓ | · | · | ✓ | 4 |
| 86 | `hqBackOffice` | Perkakas back-office HQ | · | · | · | · | · | · | ✓ | · | ✓ | · | · | · | ✓ | 3 |
| 87 | `ownNotifPrefs` | Preferensi notifikasi sendiri | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 12 |
| 88 | `hqPayoutRead` | Baca antrean payout | · | · | · | · | · | · | ✓ | · | ✓ | ✓ | · | · | ✓ | 4 |
| 89 | `commissionRuns` | Terapkan skema komisi | · | · | · | · | · | · | · | · | · | ✓ | · | · | ✓ | 2 |
| 90 | `commissionRead` | Baca skema komisi | · | · | · | · | · | · | ✓ | · | ✓ | ✓ | · | · | ✓ | 4 |
| 91 | `refundQueueRead` | Baca antrean refund | · | · | · | · | · | · | ✓ | · | ✓ | ✓ | · | · | ✓ | 4 |
| 92 | `catalogWrite` | Tulis katalog produk | · | · | · | · | · | ✓ | · | · | ✓ | · | · | · | ✓ | 3 |
| 93 | `orderReports` | Laporan pesanan jaringan | · | · | · | · | · | ✓ | ✓ | · | ✓ | · | · | · | ✓ | 4 |
| 94 | `orderReportsDepot` | Laporan pesanan satu depot | · | · | ✓ | · | · | ✓ | · | · | ✓ | · | · | · | ✓ | 4 |
| 95 | `audienceReach` | Ukuran audiens kampanye | · | · | · | · | · | · | ✓ | · | ✓ | · | · | ✓ | ✓ | 4 |
| 96 | `taxSettings` | Pajak dan template faktur | · | · | · | · | · | · | · | · | ✓ | ✓ | · | · | ✓ | 3 |
| 97 | `loyaltyAdjust` | Sesuaikan poin manual | · | · | · | · | · | ✓ | · | · | · | · | · | ✓ | ✓ | 3 |
| 98 | `loyaltyRead` | Baca angka loyalty/referral | · | · | · | · | · | ✓ | · | · | ✓ | · | · | ✓ | ✓ | 4 |
| 99 | `rewardCatalog` | Katalog hadiah | · | · | · | · | · | · | · | · | · | · | · | ✓ | ✓ | 2 |
| 100 | `customerDirectory` | Direktori pelanggan pemasaran | · | · | · | · | · | · | · | · | ✓ | · | · | ✓ | ✓ | 3 |
| 101 | `orderFulfilment` | Ubah status pesanan/fulfilment | · | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | ✓ | 6 |
| 102 | `deliveryReports` | Laporan SLA dan kurir | · | · | · | · | · | ✓ | · | · | ✓ | · | · | · | ✓ | 3 |
| 103 | `depotOperationalReport` | Laporan operasional depot | · | · | ✓ | · | · | ✓ | · | · | ✓ | ✓ | · | · | ✓ | 5 |
| 104 | `customerPhoneLookup` | Cek pelanggan per nomor HP | · | · | · | · | · | ✓ | ✓ | · | ✓ | · | ✓ | ✓ | ✓ | 6 |
| 105 | `customerNameLookup` | Cek nama pelanggan massal | · | · | · | · | · | ✓ | · | · | ✓ | · | · | · | ✓ | 3 |
| 106 | `platformAdmin` | Flag, kunci API, webhook, retensi, keamanan | · | · | · | · | · | · | · | · | · | · | · | · | ✓ | 1 |
Kolom "Jml peran" menghitung peran yang menandai ✓ (termasuk SUPER_ADMIN, tidak termasuk CUSTOMER yang tidak punya kapabilitas).

### 6.1 Kapabilitas tambahan hanya di cabang `fix/uat-g128-g149-g152` (commit 609a497, belum di `main`)

**Status: belum di `main`, belum diuji ulang.** Empat kapabilitas baca ini ditambahkan agar layar Finance tidak lagi galat izin. Masing-masing adalah peran kapabilitas dasarnya ditambah FINANCE, untuk satu rute baca yang dipakai layar. Kapabilitas dasar (`dashboard`, `orderReports`, `depotDirectory`, `returnsRead`) dan sembilan pintu `/hq` tidak berubah. Tabel di atas (nomor 1-106) tidak diubah. **[V code]**

| # | Kapabilitas (cabang) | Label matriks | Rute yang dibuka | CUS | STF | KD | ASPV | SPV | MGR | DIR | FRA | HO | FIN | HR | MKT | SA | Jml peran |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 107 | `dashboardFinance` | Baca dasbor eksekutif & jaringan (layar keuangan) | dashboard-service `/dashboard/executive` dan `/dashboard/network` | · | · | · | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | · | · | ✓ | 7 |
| 108 | `orderReportsFinance` | Baca ongkir & refund per depot (rekonsiliasi) | order-service ongkir per depot dan refund per depot (2 rute) | · | · | · | · | · | ✓ | ✓ | · | ✓ | ✓ | · | · | ✓ | 5 |
| 109 | `depotDirectoryFinance` | Baca daftar depot (layar keuangan) | depot-service `GET depots/manage` (hanya daftar depot) | · | · | ✓ | · | · | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | 7 |
| 110 | `returnsReadFinance` | Baca galon beredar jaringan (rekonsiliasi) | depot-service gallon-network | · | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | 9 |

Peran pemegang: `dashboardFinance` = HEAD_OFFICE, MANAGER, SUPERVISOR, ASSISTANT_SUPERVISOR, DIREKTUR, FINANCE, SUPER_ADMIN. `orderReportsFinance` = HEAD_OFFICE, MANAGER, DIREKTUR, FINANCE, SUPER_ADMIN. `depotDirectoryFinance` = KEPALA_DEPOT, MANAGER, HEAD_OFFICE, DIREKTUR, FRANCHISE_OWNER, FINANCE, SUPER_ADMIN. `returnsReadFinance` = KEPALA_DEPOT, MANAGER, SUPERVISOR, ASSISTANT_SUPERVISOR, HEAD_OFFICE, DIREKTUR, FRANCHISE_OWNER, FINANCE, SUPER_ADMIN.

Dampak jumlah per peran bila cabang digabung: KD 38 menjadi 40, ASPV 15 menjadi 17, SPV 21 menjadi 23, MGR 68 menjadi 72, DIR 46 menjadi 50, FRA 6 menjadi 8, HO 56 menjadi 60, FIN 21 menjadi 25, SA 106 menjadi 110; STF 12, HR 10, MKT 18, CUS 0 tetap. **[V]**

Catatan: peran selain FINANCE sudah memegang kapabilitas dasar yang sama, sehingga bagi mereka yang baru hanyalah nama kapabilitas; yang benar-benar berubah aksesnya adalah FINANCE. Keempatnya hanya membuka satu rute baca masing-masing dan tidak menambah izin tulis. **[V code]**


## 7. Verifikasi ulang di kode (dilakukan saat penulisan)

| Pemeriksaan | Hasil | Status |
|---|---|---|
| Jumlah kapabilitas di `CAPABILITIES` | 106 di `main` | **[V]** |
| Matriks dibangkitkan ulang dari kode vs tabel temuan K | 0 selisih | **[V]** |
| Jumlah kapabilitas per peran | CUS 0, STF 12, KD 38, ASPV 15, SPV 21, MGR 68, DIR 46, FRA 6, HO 56, FIN 21, HR 10, MKT 18, SA 106 (nilai `main`) | **[V]** |
| **Cabang `fix/uat-g128-g149-g152` (609a497, di atas 5a8ae4a), 2026-10-14:** isi `CAPABILITIES` dibaca dari `git show origin/fix/uat-g128-g149-g152:packages/access/src/index.ts` dan dihitung dengan skrip penghitung yang sama | 110 kapabilitas (+4: `dashboardFinance`, `orderReportsFinance`, `depotDirectoryFinance`, `returnsReadFinance`). Per peran: CUS 0, STF 12, KD 40, ASPV 17, SPV 23, MGR 72, DIR 50, FRA 8, HO 60, FIN 25, HR 10, MKT 18, SA 110. Kapabilitas dasar tidak berubah. Belum di `main`, belum diuji ulang | **[V]** |
| `refundQueue` dipakai di controller | `payment.controller.ts:642,653` (approve dan reject) | **[V]** |
| `hqPayoutApprove` dipakai | `hq-payout.controller.ts:140,152` | **[V]** |
| `approvals` | `approval.controller.ts:20` (tingkat kelas) | **[V]** |
| `dailyCloseReopen` | `daily-close.controller.ts:76`, `monthly-close.controller.ts:74` | **[V]** |
| `kasbonApprove` | `loan-request.controller.ts:68,76` | **[V]** |
| `leaveApprove` | `leave.controller.ts:102` | **[V]** |
| `accessMatrixWrite` | `access.controller.ts:107,122,135` | **[V]** |
| `pdpRequests` | `data-subject.controller.ts:63,74,93`, `consent.controller.ts:80` | **[V]** |
| `staffDelete` | `account.controller.ts:308` | **[V]** |
| `hierarchyAdmin` | `hierarchy.controller.ts:99-155` | **[V]** |
| `courierDeposit` | `driver-settlement.controller.ts:26` | **[V]** |
| `approvalThresholdWrite` | tidak ada `@Can` langsung; dipakai sebagai `requires` pada setelan `approvalAutoPassIdr` (`setting-defs.ts:66`) | **[V]** |
| Larangan memutus sendiri | approval.service.ts:138; hq-release.service.ts:93 | **[V]** |
| **Pencocokan ulang 2026-10-14 (setelah PR #664, merge f71b0b9):** isi `CAPABILITIES` e01db63 vs HEAD | Identik (diff tanpa komentar hanya menambah `HEAD_OFFICE: ['SUPER_ADMIN']` di `RESTRICTED_GRANTS`); jumlah 106 dan tabel bagian 6 tidak berubah | **[V]** |
| Perbandingan nilai `main` vs cabang | Yang berubah hanya empat entri baru; nilai kapabilitas lain identik (selisih per peran sama dengan +4 FIN/HO/MGR/DIR, +2 KD/ASPV/SPV/FRA) | **[V]** |
| `RESTRICTED_GRANTS` + `canGrantRole` | HEAD_OFFICE hanya dari SUPER_ADMIN; peran tak terdaftar (5 peran) bebas bagi pemegang `staffAdmin` | **[V]** |
| `payroll.service.ts` `approve` / `unapprove` | pembuat slip ditolak kecuali SUPER_ADMIN; `unapprove` hanya SUPER_ADMIN, hanya dari APPROVED, alasan wajib, audit `PAYROLL_UNAPPROVE` | **[V]** |
| `settlement.service.ts` | beban selisih butuh `can('approvals')` (MANAGER, SUPER_ADMIN) | **[V]** |
| `data-subject.controller.ts` / `data-subject.service.ts` | `force` hanya SUPER_ADMIN; pesanan terbuka menolak (409) | **[V]** |
| `account.service.ts` `applyActive` | menonaktifkan mencabut semua refresh token; menolak diri sendiri dan Super admin terakhir | **[V]** |
| `payment.service.ts` `approveRefund`; pencarian `refundRequestedBy` di kode | tetap tanpa cek pemohon; kolom dicatat dan ditampilkan (#665), penegakan pemohon≠penyetuju belum ada | **[V]** |
| `payout-service` penarikan | minimum `MIN_WITHDRAWAL_IDR` (bawaan 50000) di pemilik waralaba dan kurir | **[V]** |
| `loan-request.service.ts` | maks 1x gaji pokok; kedaluwarsa 3 hari kerja | **[V]** |
| Tampilan di peramban | Tidak diuji oleh penulis | **[D]** |
| `approveRefund` tidak membandingkan pemohon dengan penyetuju | payment.service.ts (tidak ada pemeriksaan pemohon) | **[V]** |

Yang **belum** diverifikasi: perilaku nyata di peramban untuk semua sel bertanda Tidak terverifikasi/[D]; nilai ambang yang dipakai di produksi; apakah ada perubahan matriks aktif di produksi (hanya dapat dilihat di `/hq/access` oleh SUPER_ADMIN atau `/dashboard/roles` untuk peran sendiri).

## 8. Celah dan pertanyaan terbuka (rujuk Bab 17 — pertanyaan terbuka)

| # | Celah | Dampak | Tag |
|---|---|---|---|
| 1 | Komentar header `index.ts:35` menyebut SPV/ASPV "tanpa tulis, uang, approval". Di kode SPV/ASPV menulis (status pesanan, dispatch), SPV juga insiden, sengketa, target, buku kas. | Dokumen ini mengikuti kapabilitas, bukan komentar. | **[B]** |
| 2 | FINANCE: layar `/hq/payments`, `/hq/reconciliation`, `/hq/franchise`, formulir komisi galat izin pada `main` (UAT 2026-10-14). Diperbaiki di cabang `fix/uat-g128-g149-g152` (609a497), belum di `main`, belum diuji ulang. | Sampai cabang digabung dan diuji ulang, alur payout Lunas/Gagal dan komisi mungkin hanya bisa dikerjakan SUPER_ADMIN. | **[B]** (cabang: **[V code]**) |
| 3 | HEAD_OFFICE memegang `approvalThresholdWrite` tetapi layar setelan terkunci `depotAdmin` (MANAGER/SA); setelan global butuh SA. | Praktis hanya SUPER_ADMIN yang dapat mengubah ambang. | **[V]** |
| 4 | ~~HEAD_OFFICE memegang `dailyCloseReopen`, tetapi layar tinjauan bulanan dibatasi `depotFinance`.~~ Diperbaiki sejak PR #664 (2026-10-14): layar memakai `dailyClose`. | Belum diuji di peramban. | diperbaiki **[V code]** |
| 5 | Refund: tidak ada pemisahan pemohon/penyetuju bila akun yang sama memegang `refundIssue` dan `refundQueue` (FINANCE, SA). Pemohon dicatat dan ditampilkan (#665), penegakan belum ada; toko tanpa FINANCE kedua akan terblokir bila ditegakkan. | Kontrol uang bergantung pada pembagian peran; menunggu PR lanjutan dan keputusan pemilik. | **[V][K]** |
| 6 | Payroll: sejak PR #664 pembuat slip tak boleh menyetujui (SUPER_ADMIN dikecualikan) dan SUPER_ADMIN dapat membatalkan persetujuan sebelum PAID. Tandai Dibayar tetap tanpa cek pelaku. | Sisa celah: penyetuju boleh membayar. | **[V]** |
| 7 | Cakupan voucher buatan MANAGER (depot vs jaringan) tidak terverifikasi. | Jangan dijanjikan sebagai "voucher depot". | **[K]** |
| 8 | ~~Komentar "HQ decides a depot's voucher request" usang.~~ Diperbaiki sejak PR #664: kapabilitas `voucherRequestDecide` ditandai RETIRED di komentar; nama dipertahankan. | Nama masih tampil di matriks; abaikan. | diperbaiki **[V]** |
| 9 | Akses ke layar HR (cuti, kasbon, pinjam karyawan) bagi MANAGER/SPV/ASPV tidak ada tautan menu dari rel `/dashboard`; hanya URL atau notifikasi. | Pengguna tidak menemukan layar persetujuan. | **[D]** |
| 10 | Penugasan lintas depot dan permintaan pinjam karyawan butuh `DEPOT_ASSIGNMENT_ENABLED` (bawaan mati). Status produksi tidak diketahui. | Baris terkait ditandai Bersyarat. | **[K]** |
| 11 | Jumlah kapabilitas MANAGER di temuan D tertulis 70, hasil hitung ulang 68. FINANCE komentar kode menyebut 19, hitung ulang 21 (25 di cabang 609a497). | Gunakan angka bab ini; komentar kode usang. | **[B]** |
| 12 | ~~Pasal 8 menyebut "sebelum depot mulai menyiapkan".~~ Diperbaiki sejak PR #664: Pasal 8 kini "sebelum kurir ditugaskan", sesuai aturan kode (aturan kode tidak berubah). Batal oleh staf sebelum kurir ditugaskan belum ada (butir keputusan 6). | — | diperbaiki **[V]** |
| 13 | Nilai ambang (Rp 100.000 refund/approval, Rp 50.000 klaim otomatis, Rp 500.000 batas manajer, Rp 5.000 surplus setoran) adalah bawaan; produksi mungkin berbeda. | Konfirmasi ke pemilik. | **[K]** |
| 14 | SUPER_ADMIN pada rute pelanggan (`@Roles(CUSTOMER)`): apakah boleh? Tidak diuji. | Sel ditandai "?". | **[D]** |
| 15 | Sejak PR #664 menonaktifkan akun mencabut semua refresh token dan menolak menonaktifkan diri sendiri/Super admin terakhir. Token akses yang sudah terbit tetap hidup hingga ± 15 menit (tidak ada pengecekan status per permintaan); penangguhan depot belum mencabut sesi stafnya. | Jangan menjanjikan kunci instan; keputusan pemilik terbuka (`tokenVersion`). | **[V][K]** |
| 16 | Label status pesanan sudah diterjemahkan sejak PR #664 (`lib/order-status.ts`); pesan penolakan 403 server berbahasa Inggris: "You do not have permission to perform this action." (artinya: Anda tidak punya izin untuk tindakan ini). | Jelaskan ke pengguna. | **[V]** |

Rujukan: Bab 03 (Kepala depot), 04 (Staf depot), 05 (Supervisor), 06 (Asisten supervisor), 07 (Waralaba), 08 (HR), 09 (HQ), 10 (Admin), 13 (Pemecahan masalah), 14 (Panduan cepat).
