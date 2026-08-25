# Rotasi rahasia (L1.5)

Yang ada sebelum dokumen ini: penjaga yang menolak nilai contoh di produksi. Yang tidak ada:
rotasi. Sebuah rahasia yang tidak pernah diganti adalah rahasia yang umurnya sama dengan
umur sistemnya, dan salah satunya sudah pernah bocor di percakapan (kunci S3, L2.2).

Dokumen ini prosedurnya. Menjalankannya **PEMILIK: Anda** — setiap langkah menyentuh kotak
produksi, dan tidak satu pun bisa dikerjakan dari repo.

---

## Jadwal yang disarankan

| Rahasia | Ritme | Kenapa segitu |
| --- | --- | --- |
| `JWT_SECRET` / `REFRESH_SECRET` | 90 hari, dan **segera** bila dicurigai bocor | Memutus semua sesi. Biaya rotasi = semua orang login ulang |
| `INTERNAL_SERVICE_KEY` | 90 hari | Hanya antar-service; tidak ada pengguna yang merasakannya |
| Kunci S3 / object storage | 90 hari, dan **sekarang** (L2.2 — kunci lama masih sah) | Kunci yang pernah bocor tetap sah sampai dicabut |
| `GRAFANA_ADMIN_PASSWORD` | 180 hari | Loopback + tunnel; risikonya rendah tapi bukan nol |
| Kredensial OTP (Zenziva) | saat penyedia memintanya, atau 180 hari | Mengganti ini memutus pendaftaran — lakukan di jam sepi |
| `PLAY_SERVICE_ACCOUNT_JSON` | 365 hari | Google merotasi kuncinya sendiri; yang penting cabut yang lama |
| Webhook alert | saat ada yang meninggalkan tim | Bukan rahasia bernilai tinggi, tapi ia mengirim ke ruang orang |

## Urutan yang benar untuk tiap rahasia

Aturannya sama untuk semuanya, dan urutannya yang membedakan rotasi dari pemadaman:

1. **Buat yang baru di penyedianya** — jangan cabut apa pun dulu.
2. **Tulis ke `.env` di VPS**, lewat `scripts/env-set.sh` (jangan editor: ia yang menjaga
   bentuk `KEY=VALUE` dan tidak menyentuh baris lain).
3. **Restart service yang membacanya.** `docker compose up -d <service>` — bukan `restart`,
   supaya kontainer dibuat ulang dengan env baru.
4. **Buktikan yang baru dipakai**: satu permintaan nyata yang hanya bisa berhasil dengan
   rahasia itu (login untuk JWT, unggah foto untuk S3, satu OTP untuk Zenziva).
5. **Baru cabut yang lama di penyedianya.** Langkah inilah yang biasanya dilewat, dan
   rahasia yang tidak dicabut bukan rahasia yang dirotasi — ia rahasia yang digandakan.
6. Catat tanggalnya di tabel di bawah.

### Yang khusus per rahasia

- **`JWT_SECRET` / `REFRESH_SECRET`** — tidak ada rotasi mulus: semua token yang beredar
  langsung tidak valid. Lakukan di jam sepi, dan beri tahu depot lebih dulu, karena setiap
  kasir dan kurir akan diminta masuk lagi di tengah shift kalau tidak.
- **`INTERNAL_SERVICE_KEY`** — semua service harus dinaikkan bersama. Selama jendela itu,
  panggilan antar-service yang lewat kunci lama menjawab 401; jendelanya sekecil satu
  `docker compose up -d` untuk seluruh stack.
- **Kunci S3** — berkas yang sudah diunggah tidak terpengaruh; yang berubah hanya kemampuan
  menulis yang baru. Cabut kunci lama SETELAH satu unggahan berhasil dengan yang baru.
- **Zenziva** — kanal OTP adalah pemblokir rilis (L2.1). Jangan merotasi ini pada hari yang
  sama dengan rilis.

## Setelah rotasi, periksa dua hal

```bash
bash scripts/env-doctor.sh          # bentuk .env masih sehat, tidak ada baris rusak
bash scripts/check-env-contract.mjs # tidak ada variabel yang dibaca tapi tak tervalidasi
```

Lalu buka satu layar yang memakainya. Sebuah rotasi yang tidak diuji dengan satu permintaan
nyata adalah rotasi yang baru ketahuan gagal saat pelanggan pertama mencoba masuk.

## Catatan rotasi — **PEMILIK: Anda**

| Rahasia | Terakhir dirotasi | Oleh | Yang lama sudah dicabut? |
| --- | --- | --- | --- |
| `JWT_SECRET` | _(belum pernah)_ | | |
| `REFRESH_SECRET` | _(belum pernah)_ | | |
| `INTERNAL_SERVICE_KEY` | _(belum pernah)_ | | |
| Kunci S3 | _(belum pernah — L2.2)_ | | |
| `GRAFANA_ADMIN_PASSWORD` | _(belum pernah)_ | | |

Kolom terakhir yang paling penting. Rahasia baru yang hidup berdampingan dengan yang lama
adalah dua rahasia, bukan satu yang diganti.
