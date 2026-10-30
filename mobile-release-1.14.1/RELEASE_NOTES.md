# Release notes 1.14.1
Teks di bawah siap ditempel ke kolom "What's new" di Play Console (batas 500 karakter per bahasa).

## Hydromart (customer) — id.hydromart.app

### Bahasa Indonesia (id-ID)  (356/500)
```
Versi 1.14.1
• Perbaikan penting: jika kamu membatalkan sidik jari/PIN saat membuka aplikasi, kini muncul layar "Sesi terkunci" dengan tombol Buka sesi, bukan halaman penuh error.
• Belum mau membuka sesi? Pilih "Lanjut tanpa masuk" untuk tetap melihat katalog.
• Sesi tetap aman: kamu bisa kembali masuk dengan kode SMS kapan saja.
• Perbaikan stabilitas.
```

### English (en-US)  (385/500)
```
Version 1.14.1
• Important fix: if you cancel the fingerprint/PIN prompt when opening the app, you now see a "Session locked" screen with an Open session button instead of a page full of errors.
• Not ready to open it? Choose "Continue without signing in" to keep browsing the catalogue.
• Your session stays safe: you can sign in again with an SMS code at any time.
• Stability fixes.
```

## Hydromart Ops — id.hydromart.ops

### Bahasa Indonesia (id-ID)  (400/500)
```
Versi 1.14.1
• Perbaikan penting: semua menu tidak lagi gagal dimuat dengan "Missing bearer token". Jika sidik jari/PIN dibatalkan, muncul layar "Sesi terkunci" dengan tombol Buka sesi.
• Supervisor dan asisten supervisor kini bisa melihat daftar kurir dan memilih kurir saat menugaskan pesanan.
• Daftar ulang wajah kini berhasil untuk karyawan yang wajahnya sudah terdaftar.
• Perbaikan stabilitas.
```

### English (en-US)  (409/500)
```
Version 1.14.1
• Important fix: menus no longer fail to load with "Missing bearer token". If the fingerprint/PIN prompt is cancelled, a "Session locked" screen with an Open session button appears.
• Supervisors and assistant supervisors can now see the courier list and pick a courier when assigning an order.
• Re-enrolling your face now works for employees who already had one registered.
• Stability fixes.
```

## Catatan internal (jangan ditempel ke Play)
- Memperbaiki: Ops 1.14.0 menampilkan "Missing bearer token" di semua menu setelah prompt biometrik dibatalkan (PR #686). Kode token tidak berubah sejak 1.13, jadi build 1.13 juga terdampak.
- **Urutan wajib:** merge #686 -> tunggu deploy produksi selesai -> baru buat tag `mobile-v1.14.1` dari `main`. Dua butir terakhir catatan Ops (roster supervisor, daftar ulang wajah) hanya benar setelah server ter-deploy; jangan kirim ke Play sebelum itu.
- versionCode dari nomor run CI (otomatis lebih tinggi dari 1.14.0 = 8801). Cek di Play Console sebelum mengunggah.
- Saran rollout: Internal testing dulu, lalu Production bertahap 10%, pantau 24 jam sebelum 100%.
- **Uji sebelum Production** (di HP, build dari Play Internal): (1) login, tutup paksa, buka, batalkan prompt -> harus muncul "Sesi terkunci"; Buka sesi -> menu normal. (2) Daftar / Perbarui Wajah dengan akun yang tadinya gagal "UserID Already Exists" -> harus berhasil. (3) Akun SUPERVISOR: buka pesanan berstatus PREPARING -> daftar kurir muncul.
- Memantau setelah rilis: belum ada metrik/alert 401 di gateway (rencana Tahap 3 belum dikerjakan). Cara manual: ssh ke VPS, hitung respons 401 tanpa header authorization dari `x-app-id` `id.hydromart.ops` di `docker logs` auth/delivery/loyalty/crm; targetnya mendekati nol untuk build 1.14.1.
- Pengguna 1.14.0 yang terkena sebelum update tiba: tutup paksa app lalu buka lagi.
- Pelanggan yang sudah login lalu membatalkan prompt kini melihat overlay (bisa "Lanjut tanpa masuk"); sebelumnya mendarat di katalog tampak sebagai tamu padahal sesinya masih tersimpan.
