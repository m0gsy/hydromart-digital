# Fase M — empat item yang ditutup dengan pengukuran, bukan dengan pekerjaan

Ditutup 2026-08-26, terhadap `main` = `0269b1e4`.

Empat item Fase M tidak diselesaikan dengan menulis kode, karena mengukurnya menunjukkan
tidak ada kode yang perlu ditulis — atau menunjukkan bahwa yang diminta tidak bisa dicapai
lewat jalan yang itemnya sebutkan. Semuanya dicatat di sini supaya tidak dibuka ulang oleh
orang berikutnya yang membaca rencananya dan mengira item ini terlewat.

Aturan yang berlaku di seluruh dokumen: **tiap angka membawa perintah yang menghasilkannya.**

---

## M16 — premisnya mati

Barisnya menggantungkan seluruh item pada satu pertanyaan:

> M16 wajib diverifikasi dulu: apakah compose Anda error atau melewati `scheduler`

Ditanyakan langsung ke kotak produksi lewat `scripts/ask-the-box.sh` (baca-saja, mode
`diagnose` di workflow `Registry pull check`):

```
== M16 — does compose error, or skip the scheduler?
  compose config : OK (parses and resolves)
  scheduler      : PRESENT in the resolved config
== M16 — is the scheduler actually running?
scheduler	running	healthy
```

Jawabannya **tidak dua-duanya**. Compose tidak error, dan `scheduler` tidak terlewat — ia ada
di konfigurasi yang ter-resolve dan sedang berjalan sehat. Premis yang menggantung item ini
tidak berlaku, jadi tidak ada yang perlu diperbaiki.

**Kalau ini dibuka ulang**, jalankan mode `diagnose` itu lagi sebelum menulis kode apa pun.
Pertanyaannya hanya punya jawaban di kotaknya, dan jawabannya bisa berubah kalau versi compose
di sana berubah.

---

## M10 — terukur, dan sekarang sebuah keputusan yang aman

Dua fakta, keduanya diukur hari ini.

**Kotaknya berjalan tanpa `IMAGE_PREFIX`.**

```
== M10 — registry mode
  IMAGE_PREFIX : not set
  IMAGE_TAG : not set
  -> build-locally mode: this box compiles all nineteen images itself.
     CI publishes images every merge that nothing here consumes.
```

**Dan kotaknya BISA menarik.** Ini yang dulu tidak diketahui siapa pun, dan yang membuat flip-nya
terasa berisiko:

```
Probing ghcr.io/m0gsy/hydromart-digital-auth:0269b1e43b3c16cbfc80dbcf4ff3e73de4695a48
OK — the box can pull from this registry.
digest: ghcr.io/m0gsy/hydromart-digital-auth@sha256:4f635e6f89fba…
(removed again — this probe leaves nothing behind)
```

Jadi jalur registry-nya terbukti hidup: kredensial ada, paket bisa dijangkau, dan probe-nya
tidak meninggalkan apa pun di disk. Prasyarat urutannya (M11, `deploy` menunggu image commit-nya
sendiri) sudah mendarat.

### Kalau Anda memutuskan flip

Satu baris di `.env` kotaknya, lalu satu deploy:

```sh
IMAGE_PREFIX=ghcr.io/m0gsy/hydromart-digital-
# IMAGE_TAG diisi deploy dari SHA yang CI-nya hijau; jangan dipatok manual.
```

Sebelum menyalakannya, jalankan sekali lagi probe-nya dengan SHA yang benar-benar diterbitkan
(`Registry pull check`, mode `pull`) — itu memeriksa hal yang deploy pertama akan bergantung
padanya, tanpa mengubah apa pun.

**Kalau Anda memutuskan TIDAK flip**, itu juga jawaban yang sah — tapi catat konsekuensinya:
CI menerbitkan sembilan belas image tiap merge yang tidak dipakai siapa pun, dan VPS membangun
ulang dari sumber setiap deploy.

---

## M15 — badannya tidak hilang, dan itemnya sudah dikerjakan

Audit menandai M15 "tanpa deskripsi". Itu salah, dan yang membuktikannya adalah pemeriksa yang
ditugasi menyerang rekonstruksinya: teks aslinya ada utuh di scratchpad rencana yang lebih tua
(`plan-a-n.txt:981-985`).

Isinya sudah dikerjakan — lihat `scripts/deploy.sh`, komentar M15 di sekitar stack lock dan di
atas `migrate-prod.sh`. Dicatat di sini hanya supaya "tanpa deskripsi" tidak terus diulang.

**Pelajarannya lebih luas dari itemnya**: sebelum menyatakan sebuah item kehilangan badannya,
cari di scratchpad rencana yang lebih lama. Rencana ini pernah ditulis ulang, dan penulisan
ulang itu yang memangkas badan beberapa item — bukan penulis aslinya yang tidak menulisnya.

---

## M2 — dua dari tiga klausanya sudah terpenuhi, yang ketiga tidak bisa dicapai lewat tiering

M2 kehilangan badannya, tapi baris verifikasinya selamat, dan baris verifikasi menyatakan
permintaannya secara terbalik:

> satu PR dengan galat typecheck sengaja — harus merah dalam ≤ 6 menit, dan `integration`/`e2e`
> tidak boleh pernah mulai. Satu PR bersih — jalur kritis turun ke ~26 menit.

### Klausa 1 — LULUS

Galat typecheck memerahkan `gate` pada **2m24s** (`Install` 36s, 38 pemeriksaan skrip 15s,
`Typecheck` selesai 18:52:42 dari job yang mulai 18:50:18). `Lint` dan `Build` berjalan SESUDAH
typecheck, jadi keduanya tidak dibayar saat typecheck gagal. Ambangnya 6 menit; sisa ruangnya
lebih dari dua kali lipat.

### Klausa 2 — LULUS, dan sudah sejak sebelum rencananya ditulis

`verify` (`ci.yml`) butuh `[gate, test, visual]` dengan `if: always()` dan keluar 1 kecuali
ketiganya `success`. `integration` dan `e2e` butuh `[verify, changes]` dengan `if:` yang TIDAK
memanggil `always()`, jadi `verify` yang gagal membuat keduanya di-skip. Terpasang sejak
`4bfbf6b8` (5 Agustus), dua pekan sebelum rencananya ditulis.

### Klausa 3 — TIDAK BISA DICAPAI lewat memindahkan pekerjaan antar-tier

Durasi job nyata di `main` (`gh api .../runs/<id>/jobs`):

| job | durasi |
| --- | --- |
| gate | 7m33s |
| visual | 6m41s |
| shard tes terlama | 3m29s |
| verify | 0m03s |
| **e2e** | **25m25s** |

Jalur kritis = tier-1 (7m36s) + e2e (25m25s) = **33m01s**.

Perbaikan yang jelas — memindahkan `Lint` (86s) dan `Build` (189s) keluar dari `gate` ke job
tier-2 tersendiri — menurunkan `gate` ke ~2m30s. Tapi tier-1 lalu dibatasi `visual` di 6m41s,
jadi hematnya **55 detik**, bukan lima menit. Dan itu tidak melonggarkan apa pun: job baru itu
tetap masuk `needs` milik `verify`, jadi `integration`/`e2e` tetap menunggunya.

Aritmetika yang menutup pertanyaannya: untuk mencapai 26 menit dengan e2e di 25m25s, tier-1
harus selesai dalam **35 detik**. Itu lebih pendek dari `npm ci` sendirian. **e2e sendirian
sudah 97% dari target M2.**

Jadi tiering-nya sudah selesai — M4/M5 (#329) yang menyelesaikannya, menurunkan tier-1 dari 22
menit ke ~7. Yang tersisa dari target M2 hanya bisa dibeli dari e2e, bukan dari menyusun ulang
tier. Itu item yang berbeda, dan sebaiknya ditulis sebagai item yang berbeda: **apa yang
membuat e2e 25 menit, dan mana yang bisa dihapus tanpa kehilangan cakupan.**

**Yang SENGAJA tidak dikerjakan:** pemindahan Lint/Build senilai 55 detik. Ia menambah satu job
dan satu `npm ci` untuk menghemat kurang dari satu menit pada jalur kritis 33 menit, dan
menyembunyikan temuan yang sebenarnya di balik angka yang terlihat membaik.
