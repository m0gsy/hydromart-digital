# Rekonsiliasi referral dan replay outbox order

Status stack lokal utama, 2026-11-04: image `hydromart-order:local` dan `hydromart-referral:local` dibangun dari commit `0df2cdeb7` lalu kedua container dibuat ulang tanpa menyentuh dependensi. ID image container cocok dengan tag hasil build; order, referral, loyalty, dan scheduler berstatus `healthy`. Pemeriksaan baca saja pada PostgreSQL utama menunjukkan `referrals` **0 baris** (termasuk `QUALIFIED` 0) dan `outbox_messages` **DONE 10, DEAD 0, PENDING 0**. Karena tidak ada kandidat, tidak ada kredit atau replay data yang dijalankan.

## Aturan rekonsiliasi hadiah referral

1. Ambil referral `QUALIFIED` dari `hydromart_referral`: `id`, kedua customer ID, `qualifyingOrderId`, `referrerPoints`, `refereePoints`, `qualifiedAt`. Periksa order yang dirujuk di `hydromart_order`; hanya order `COMPLETED` yang layak menerima hadiah. Order `VOIDED`/`CANCELLED`, order yang hilang, atau jumlah poin nol masuk antrean tinjau, tanpa kredit otomatis.
2. Untuk setiap sisi dengan poin positif, cari transaksi `REWARD` pada `hydromart_loyalty` dengan pasangan `(customerId, idempotencyKey)` masing-masing `referral:<id>:referrer` dan `referral:<id>:referee`. Cocokkan jumlah poin. Periksa juga transaksi lama dengan `idempotencyKey` null dan alasan referral, karena hadiah sebelum perbaikan belum memakai kunci tersebut. Jika ada kemungkinan transaksi lama cocok, tahan kasus untuk pemeriksaan manual; jangan menerbitkan kredit kedua.
3. Hanya sisi yang terbukti belum menerima kredit yang boleh diberi ulang melalui endpoint reward internal loyalty, memakai customer ID, jumlah poin yang tersimpan pada referral, alasan referral yang sama, dan kunci idempoten di atas. Catat ID referral, order, ID transaksi sebelum/sesudah, operator, dan waktu pada tiket insiden. Jangan mengubah status referral atau menulis langsung ke ledger/balance SQL.
4. Setelah setiap kredit, baca kembali ledger dan saldo. Jika hasil tidak cocok, hentikan batch dan investigasi. Referral yang kemudian di-void memerlukan penilaian ledger dan aturan kompensasi terpisah; replay hadiah tidak dipakai sebagai kompensasi.

Aturan ini sengaja tidak melakukan backfill massal: transaksi lama tanpa kunci tidak dapat dibedakan secara aman hanya dari status `QUALIFIED`.

## Aturan replay satu baris `DEAD`

1. Baca baris `outbox_messages` berdasarkan ID beserta `topic`, `orderId`, `attempts`, `lastError`, dan status order. Perbaiki penyebab kegagalan penerima lebih dulu, lalu simpan bukti sebelum perubahan. Jalankan satu ID per tindakan; jangan mengubah seluruh baris `DEAD` sekaligus.
2. Topik `INVENTORY_CONSUME`, `LOYALTY_AWARD`, `REFERRAL_QUALIFY`, `FRANCHISE_REVENUE`, dan `GALLON_ISSUE` hanya boleh diulang jika order masih `COMPLETED`. `PAYMENT_REVERSAL` hanya untuk `CANCELLED`; `FRANCHISE_REVENUE_VOID` hanya untuk `VOIDED`. Jika status berbeda, tahan untuk investigasi; jangan mengubahnya ke `PENDING`.
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
      OR (m.topic = 'FRANCHISE_REVENUE_VOID' AND o.status = 'VOIDED')
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
