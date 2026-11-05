# Alur lintas layanan yang ditinjau

Audit ini membaca jalur kode, bukan menjalankan transaksi. Status sesudah kegagalan adalah kemungkinan yang diturunkan dari urutan operasi; frekuensi produksi belum diketahui.

| Alur | Aktor dan batas lokal | Handoff dan titik gagal | Pemulihan yang terlihat | Keputusan audit |
|---|---|---|---|---|
| Checkout ke stok, poin, referral, waralaba | order-service menyimpan order dan outbox | Empat adapter HTTP dapat mengembalikan tanpa melempar saat penerima gagal | outbox menandai DONE jika handler resolve; replay tidak terjadi untuk kegagalan yang ditelan | ORD-01: audit idempotensi penerima sebelum retry wajib |
| Bukti pengantaran ke order, earning, webhook | kurir menuntaskan delivery dan proof tersimpan | advance order dapat gagal; earning dan event dipanggil asynchronous | replay DELIVERED langsung kembali, sehingga efek yang gagal tidak otomatis diulang | DLV-07: simpan intent recovery dan identitas dedupe |
| Reschedule ke order | delivery disimpan RESCHEDULED | hand-back ke order PREPARING dilakukan sesudah status lokal | replay tanggal sama berhenti lebih awal jika cashReturned tidak true | DLV-01: perbaiki replay hand-back tanpa mengulang pembalikan kas |
| Referral ke poin | referral menjadi QUALIFIED | dua reward dikirim setelah transisi; adapter menelan kegagalan | replay QUALIFIED langsung kembali | REF-01: intent reward per sisi dan dedupe penerima |
| Pembayaran berbukti ke antrean staf | payment PENDING dan proofUrl dapat terisi | sweep TTL mencari PENDING tanpa menyaring proofUrl | CAS menjadi FAILED terminal; bukti perlu review manusia | PPA-01: pisahkan kedaluwarsa tanpa bukti dari antrean bukti |
| PO ke stok | purchase order SENT dibaca; receiveStock dipanggil per baris | status PO diperbarui setelah loop | retry/crash dapat memposting ulang stok; kontrak receipt perlu dibuat atomik/idempoten | DEP-02: desain identitas receipt dan pemulihan parsial |

Sumber baris: `recommendations.json` untuk ORD-01, DLV-07, DLV-01, REF-01, PPA-01 dan DEP-02 memuat path serta baris source yang dibaca ulang. Urutan lintas database tidak transaksional; tabel ini tidak menyatakan receiver sudah idempoten. Status batal/refund dan pembagian franchise menunggu keputusan Finance/Produk.
