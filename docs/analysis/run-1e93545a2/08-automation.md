# Otomasi yang ada dan batas pemulihannya

| Jalur | Pemicu saat ini | Kontrol yang terlihat | Celah dan langkah berikutnya |
|---|---|---|---|
| Order outbox | worker outbox mengirim topik stok, poin, referral, franchise | retry saat handler melempar | ORD-01: adapter yang menelan error membuat DONE terlalu dini; pastikan kontrak kegagalan penerima dan dedupe sebelum replay |
| Sweep pembayaran TTL | jadwal mencari pembayaran PENDING lama | CAS status dan pengecualian metode tertentu | PPA-01: proofUrl belum membedakan kasus yang perlu tinjau; lindungi race upload dan sweep |
| Kampanye CRM | worker memproses recipient dengan lease | notifikasi mendukung dedupeKey bila dikirim | CRM-01: delivery kampanye belum membawa key per recipient; lease kedaluwarsa dapat mengirim ulang |
| Rebuild forecast | feed order dibaca per page | ingest real-time best-effort | FCS-04: error feed diperlakukan seperti EOF; simpan status incomplete/cursor sebelum menjanjikan backfill |
| Reminder reorder | jadwal harian | batas batch 500 | RET-01: hasil boolean pengiriman dan pengulangan nudge perlu dipisahkan; jangan menyebut semua penerima berhasil |

Ini adalah pemetaan source dan usulan minimum, bukan bukti job berjalan pada jadwal produksi. Kunci, lease, status retry dan urutan receiver perlu diuji dengan fault injection pada tugas implementasi yang terpisah.
