# Rekonsiliasi referral dan replay outbox order

Status stack lokal utama, 2026-11-04: image order, referral, dan loyalty dibangun dari perubahan void referral dan ketiga container dibuat ulang satu per satu tanpa menyentuh dependensi. ID image container cocok dengan tag hasil build; order, referral, loyalty, dan scheduler berstatus `healthy`. Migrasi `20261104180000_voided_referral_orders`, `20261104180000_referral_void_shortfall`, serta migrasi loyalty lama yang masih tertunda `20261030130000_points_txn_idempotency_key` berhasil diterapkan. Pemeriksaan baca saja pada PostgreSQL utama menunjukkan `referrals` **0 baris**, `voided_referral_orders` **0 baris**, selisih poin **0 baris**, dan `outbox_messages` **DONE 10, DEAD 0, PENDING 0**. Karena tidak ada kandidat, tidak ada kredit atau replay data yang dijalankan. Skenario pembalikan, saldo kurang, grant terlambat, dan kualifikasi ulang lulus pada project Docker tes terpisah.

## Kebijakan void referral yang dipilih

Jika order yang pertama mengualifikasi referral di-void, kedua hadiah dibalik satu kali dan referral kembali `PENDING`. Order sah berikutnya dapat mengualifikasi ulang dengan kunci hadiah yang memuat ID order. Saldo tidak turun di bawah nol; poin hadiah yang sudah terpakai dicatat pada kolom ledger `points_transactions."uncollectedPoints"`, tanpa tagihan otomatis. Penanda `voided_referral_orders` menolak kualifikasi terlambat dari order lama. Void menulis `REFERRAL_REVERSE` ke outbox yang tahan gagal; jika referral-service sedang mati, sweep mencoba lagi dan mengirim alert saat batas retry habis. Peninjauan selisih audit:

```sql
SELECT "customerId", "idempotencyKey", "uncollectedPoints", "createdAt"
FROM points_transactions
WHERE "uncollectedPoints" > 0
ORDER BY "createdAt" DESC;
```

Query itu dijalankan pada `hydromart_loyalty` oleh operator berwenang; customer ID tidak dicetak di laporan publik. Anonimisasi alasan transaksi tidak menghapus angka selisih.

## Aturan rekonsiliasi hadiah referral

1. Ambil referral `QUALIFIED` dari `hydromart_referral`: `id`, kedua customer ID, `qualifyingOrderId`, `referrerPoints`, `refereePoints`, `qualifiedAt`. Periksa order yang dirujuk di `hydromart_order`; hanya order `COMPLETED` yang layak menerima hadiah. Order `VOIDED`/`CANCELLED`, order yang hilang, atau jumlah poin nol masuk antrean tinjau, tanpa kredit otomatis.
2. Untuk setiap sisi dengan poin positif, cari transaksi `REWARD` pada `hydromart_loyalty` dengan pasangan `(customerId, idempotencyKey)` masing-masing `referral:<id>:<qualifyingOrderId>:referrer` dan `referral:<id>:<qualifyingOrderId>:referee`; periksa juga kunci lama `referral:<id>:referrer` dan `referral:<id>:referee`. Cocokkan jumlah poin. Periksa transaksi lebih lama dengan `idempotencyKey` null dan alasan referral. Jika ada kemungkinan transaksi lama cocok, tahan kasus untuk pemeriksaan manual; jangan menerbitkan kredit kedua.
3. Hanya sisi yang terbukti belum menerima kredit yang boleh diberi ulang melalui endpoint reward internal loyalty, memakai customer ID, jumlah poin yang tersimpan pada referral, alasan referral yang sama, dan kunci idempoten sesuai order yang mengualifikasi. Catat ID referral, order, ID transaksi sebelum/sesudah, operator, dan waktu pada tiket insiden. Jangan mengubah status referral atau menulis langsung ke ledger/balance SQL.
4. Setelah setiap kredit, baca kembali ledger dan saldo. Jika hasil tidak cocok, hentikan batch dan investigasi. Pembalikan void berjalan melalui outbox `REFERRAL_REVERSE`; replay hadiah manual tidak dipakai sebagai kompensasi.

Aturan ini sengaja tidak melakukan backfill massal: transaksi lama tanpa kunci tidak dapat dibedakan secara aman hanya dari status `QUALIFIED`.

## Aturan replay satu baris `DEAD`

Uji pada 2026-11-05 memakai project Docker `hydromart-audit-dead-replay` dengan database dan volume baru. Fixture `REFERRAL_REVERSE` berstatus `DEAD` tidak dapat dibuka saat order masih `COMPLETED`; sesudah order menjadi `VOIDED`, hanya satu baris berubah ke `PENDING`. Sweep internal mengubahnya menjadi `DONE`, membalik kedua hadiah, dan sweep berikutnya tidak mengulang efek. Tes ada di `test/integration/referral-dead-replay.mjs`; project dan volume tes diturunkan setelah pemeriksaan. Data stack utama tidak diubah.

1. Baca baris `outbox_messages` berdasarkan ID beserta `topic`, `orderId`, `attempts`, `lastError`, dan status order. Perbaiki penyebab kegagalan penerima lebih dulu, lalu simpan bukti sebelum perubahan. Jalankan satu ID per tindakan; jangan mengubah seluruh baris `DEAD` sekaligus.
2. Topik `INVENTORY_CONSUME`, `LOYALTY_AWARD`, `REFERRAL_QUALIFY`, `FRANCHISE_REVENUE`, dan `GALLON_ISSUE` hanya boleh diulang jika order masih `COMPLETED`. `PAYMENT_REVERSAL` hanya untuk `CANCELLED`; `FRANCHISE_REVENUE_VOID` dan `REFERRAL_REVERSE` hanya untuk `VOIDED`. Jika status berbeda, tahan untuk investigasi; jangan mengubahnya ke `PENDING`.
3. Pastikan penerima untuk topik itu tetap idempoten terhadap order/kunci yang sama, dan periksa apakah efeknya sudah tercatat. Bila sudah, jangan kirim ulang secara manual; tutup kasus melalui prosedur koreksi yang terdokumentasi. Jika masih terutang, ubah tepat satu baris `DEAD` ke `PENDING` dengan transaksi bersyarat di bawah, lalu biarkan sweep terjadwal memanggil handler biasa.
4. Setelah sweep, verifikasi baris menjadi `DONE` dan efek penerima benar-benar tercatat. Jika kembali `DEAD`, hentikan replay, simpan error baru, dan eskalasi. Untuk `PAYMENT_REVERSAL`, status `DONE` di order tidak menggantikan bukti refund/approval di payment-service.

Contoh transaksi untuk operator yang telah mengisi tiga nilai dari hasil pemeriksaan. `UPDATE` mengembalikan **tepat satu baris** atau melakukan `ROLLBACK`; nol baris berarti status/order berubah atau input salah. Simpan keluaran sebelum `COMMIT`.

```sql
BEGIN;
WITH target AS (
  SELECT m.id
  FROM outbox_messages AS m
  JOIN orders AS o ON o.id = m."orderId"
  WHERE m.id = :'outbox_id'::uuid
    AND m."orderId" = :'order_id'::uuid
    AND m.topic = :'topic'
    AND m.status = 'DEAD'
    AND (
      (m.topic IN ('INVENTORY_CONSUME','LOYALTY_AWARD','REFERRAL_QUALIFY','FRANCHISE_REVENUE','GALLON_ISSUE') AND o.status = 'COMPLETED')
      OR (m.topic = 'PAYMENT_REVERSAL' AND o.status = 'CANCELLED')
      OR (m.topic IN ('FRANCHISE_REVENUE_VOID','REFERRAL_REVERSE') AND o.status = 'VOIDED')
    )
  FOR UPDATE OF m
)
UPDATE outbox_messages AS m
SET status = 'PENDING', attempts = 0, "nextAttemptAt" = now(), "updatedAt" = now()
FROM target
WHERE m.id = target.id
RETURNING m.id, m.topic, m."orderId", m.status;
-- COMMIT hanya jika tepat satu baris yang diharapkan dikembalikan; selain itu ROLLBACK.
```

Jalankan melalui `psql -U hydromart -d hydromart_order` pada container PostgreSQL stack yang benar. Nilai `outbox_id`, `order_id`, dan `topic` diberikan lewat variabel `psql` setelah preview. Tidak ada endpoint replay massal; SQL bersyarat ini hanya untuk pemulihan insiden yang ditinjau operator.
