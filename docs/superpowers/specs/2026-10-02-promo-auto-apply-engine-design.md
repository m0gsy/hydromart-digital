# Desain: Mesin Promo Auto-Apply (Item 5, Fase 1)

Status: disetujui user 2026-10-02. Fase 1 dari item 5 (2026 evaluation list) — hanya bagian A
(mesin promo auto-apply). Bagian B (voucher per-item), C (kebijakan stacking promo+voucher),
D (admin UI lengkap), E (audit kalkulasi lama) adalah fase terpisah, belum di-scope di sini.

## Konteks

Sistem saat ini di `promo-service` cuma punya dua model: `Voucher` (kode manual, diketik
customer, diskon whole-order, no-stacking per BR-015) dan `Promotion` (banner marketing di
home, bukan rule harga). Tidak ada mesin promo auto-apply: tidak ada jadwal hari/jam, scope
produk/kategori, atau kelipatan (BUY_X_GET_Y). Lima contoh promo di daftar evaluasi
(Beli 1 Gratis 1, Harga Khusus, Jumat Berkah, Senin Optimis, Ongkir) butuh mesin baru.

## Taksonomi Promo

Tiga jenis (`PromoKind`), mencakup kelima contoh — ditambah nanti kalau beneran dibutuhkan:

- **SPECIAL_PRICE** — override harga per-unit suatu produk/kategori (Harga Khusus, Jumat
  Berkah, Senin Optimis — bedanya cuma jadwal + channel).
- **BUY_X_GET_Y** — tiap `X` unit dibeli, dapat `Y` unit gratis, produk gratis = produk yang
  sama persis yang dibeli (Beli 1 Gratis 1, kelipatan penuh: beli 3 → bayar 3 dapat 3 gratis,
  `freeQty = floor(quantity / buyQty) * getQty`).
- **SHIPPING_DISCOUNT** — override ongkir per-galon (`perUnitFee` di `domain/pricing.ts`
  diganti nilai promo). Ongkir dihitung per-galon di order-service (`perUnitFee ×
  galonQuantity`), bukan per baris produk, jadi promo ini berlaku di level order.

## Data Model (promo-service)

```prisma
enum PromoKind {
  SPECIAL_PRICE
  BUY_X_GET_Y
  SHIPPING_DISCOUNT
}

enum SalesChannel {
  APP
  COUNTER
}

model PromoRule {
  id          String    @id @default(uuid())
  name        String                      // tampil di invoice/laporan, mis. "Jumat Berkah"
  kind        PromoKind
  depotId     String?                     // null = network-wide, sama pola Voucher (CA-2-65)
  productId   String?                     // null + categoryId null = semua produk
  categoryId  String?

  specialPrice         Int?               // wajib kalau kind=SPECIAL_PRICE
  buyQty                Int?              // wajib kalau kind=BUY_X_GET_Y
  getQty                Int?              // wajib kalau kind=BUY_X_GET_Y
  shippingFeeOverride   Int?              // wajib kalau kind=SHIPPING_DISCOUNT

  validFrom   DateTime?
  validUntil  DateTime?
  daysOfWeek  Int[]                       // 0=Minggu..6=Sabtu, kosong = semua hari
  startTime   String?                     // "HH:mm", null = sejak buka
  endTime     String?                     // "HH:mm", null = sampai tutup

  minQty      Int        @default(1)
  maxQty      Int?
  channels    SalesChannel[]              // kosong = semua channel

  active      Boolean    @default(true)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  @@index([active, depotId])
  @@map("promo_rules")
}

model PromoApplication {
  id           String   @id @default(uuid())
  orderId      String
  promoRuleId  String
  promoRule    PromoRule @relation(fields: [promoRuleId], references: [id], onDelete: Restrict)
  productId    String?
  discountValue Int
  createdAt    DateTime @default(now())

  @@index([orderId])
  @@map("promo_applications")
}
```

Validasi "field wajib per kind" di application layer (service), bukan DB constraint — sama
pola dengan `Voucher`/`DiscountType` yang sudah ada. `PromoApplication` adalah audit trail,
`onDelete: Restrict` sama seperti `VoucherRedemption` (catatan finansial tidak boleh hilang
kalau rule-nya dihapus).

## Algoritma Evaluasi

Endpoint baru `POST /promotions/auto-apply/quote` di promo-service.

Input: `{ depotId, channel, occurredAt, lines: [{ productId, categoryId, quantity,
unitPrice }] }`. `occurredAt` = waktu server, bukan dari client.

Per baris produk:

1. **Filter kandidat**: `PromoRule` aktif yang `depotId` cocok (null atau sama), `productId`/
   `categoryId` cocok, jadwal cocok (`validFrom/Until`, `daysOfWeek`, `startTime/endTime`
   terhadap `occurredAt`), `channels` cocok (kosong atau match), `quantity` dalam
   `minQty..maxQty`.
2. **Kelompokkan per `kind`**, pilih satu pemenang per kelompok yang muncul:
   - `SPECIAL_PRICE`: `specialPrice` terendah menang.
   - `BUY_X_GET_Y`: nilai gratis terbesar menang — `freeQty = floor(quantity/buyQty)*getQty`,
     nilai = `freeQty × (specialPrice pemenang ?? unitPrice)`.
   - `SHIPPING_DISCOUNT`: `shippingFeeOverride` terendah menang (level order, bukan per baris).
3. **Stacking lintas-kind**: SPECIAL_PRICE dan BUY_X_GET_Y BOLEH menang bersamaan di baris
   yang sama (barang gratis dihargai di harga yang sudah kena SPECIAL_PRICE). SHIPPING_DISCOUNT
   independen dari keduanya.
4. **Output**: per baris `{ productId, appliedPromoIds, unitPriceAfter, freeQty, lineTotal }`,
   plus satu `shippingFeeOverride` level order (null kalau tidak ada yang cocok).

Setiap promo yang menang direkam di `PromoApplication` saat order dibuat.

## Integrasi Checkout (order-service)

- Port baru `PromoAutoApplyPort.quote(depotId, channel, occurredAt, lines)`, dipanggil di
  titik yang sama dengan `PromoPort.quote` (voucher) — saat cart di-price ulang dan saat
  checkout final.
- **Fail open**: promo-service unreachable/error → lanjut dengan harga normal (tidak ada
  baris yang di-adjust), log warning + alert ops. Beda dengan voucher (fail closed) karena
  promo auto-apply tidak diketik customer — checkout tidak boleh terblokir oleh layanan
  "nice-to-have".
- `channel` diturunkan dari `Order.isWalkIn` yang sudah ada (`true` → COUNTER, `false` →
  APP) — tidak perlu kolom baru di `Order`.
- Baris gratis (`freeQty`) masuk sebagai tambahan `quantity` di `OrderItem` yang sama dengan
  `unitPrice: 0` untuk porsi gratisnya — stok tetap terpotong benar, laporan "galon terkirim"
  tetap akurat (bukan baris terpisah).

## Admin UI (minimal, fase 1)

Halaman baru `/hq/promo-rules` (semua depot) dan `/dashboard/promo-rules` (scope depot
sendiri) — pola yang sama dengan halaman voucher yang sudah ada di dua tempat. List + form
create/edit: Nama, Jenis (dropdown 3 kind), Produk/Kategori (picker yang sama dengan halaman
harga), field spesifik-kind tampil kondisional di form, Jadwal (tanggal, checkbox hari, jam),
Min/Max qty, Channel (checkbox APP/COUNTER), toggle Aktif.

Capability baru `promoRuleAdmin` di `packages/access` (guard backend + gating halaman web),
diberikan ke role yang sekarang pegang `voucherAdmin`/`promotionAdmin`.

## Error Handling & Testing

- Validasi create/update: field wajib per `kind`, `validFrom <= validUntil`, enum-safe
  `channels`/`daysOfWeek`. Response 400 per field yang salah, pola sama dengan
  `promotion.controller.ts`.
- Unit test: matching jadwal/produk/channel, resolusi menang-kalah same-kind, stacking
  cross-kind, BOGO kelipatan.
- Integration test: endpoint `/promotions/auto-apply/quote`.
- Order-service: test fail-open (mock port throw → checkout tetap lanjut harga normal), test
  stok/`OrderItem` untuk baris gratis.
- Semua migration baru bersifat additive (tabel baru) — tidak ada `DROP`/`RENAME`/destructive.

## Keputusan yang Diambil (rangkuman)

| Keputusan | Pilihan |
|---|---|
| Lokasi evaluasi | promo-service (lanjutan pola `PromoPort`) |
| Jenis promo | 3: SPECIAL_PRICE, BUY_X_GET_Y, SHIPPING_DISCOUNT |
| BOGO kelipatan | Penuh — tiap 1 beli dapat 1 gratis (bukan pasangan genap) |
| Produk gratis BOGO | Sama persis dengan produk yang dibeli |
| Scope depot | Depot-scoped seperti Voucher (`depotId` nullable) |
| Konflik same-kind | Paling menguntungkan customer menang (bukan field prioritas manual) |
| Konflik cross-kind | SPECIAL_PRICE + BUY_X_GET_Y boleh stacking |
| promo-service down saat checkout | Fail open — checkout tetap lanjut harga normal |

## Di Luar Scope Fase 1

- Voucher per-item (masih whole-order discount).
- Stacking promo dengan Voucher (BR-015 "no voucher stacking" tetap berlaku apa adanya).
- Audit menyeluruh kalkulasi diskon yang sudah ada (item 5 bagian E).
- Jenis promo baru di luar 3 yang terdaftar (mis. PERCENTAGE_OFF per kategori).
