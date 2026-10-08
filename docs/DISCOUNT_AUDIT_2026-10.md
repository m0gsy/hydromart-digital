# Audit kalkulasi diskon (item 5, bagian E)

Dibaca 2026-10-08: `promo-service/src/domain/voucher.ts`, `loyalty-service/src/domain/membership.ts`,
`order-service/src/domain/pricing.ts` (reseller), `domain/promo-adjustment.ts`, urutan diskon di
`OrderService.checkout()`, `CartService`, subscription. Hanya temuan yang bisa dibuktikan dari kode.

## Sudah benar (diperiksa, tidak perlu diubah)
- Pembulatan: voucher persen dan membership sama-sama `money()` (half-up). Tidak ada selisih sen.
- Voucher, membership, dan promo otomatis: diskon barang di-cap ke subtotal, FREE_SHIPPING di-cap ke ongkir. Tidak bisa membuat total di bawah ongkir. Dikunci tes di PR #620.
- SPECIAL_PRICE hanya bisa menurunkan harga (`specialPrice < unitPrice`), tidak bisa menaikkan.
- Reseller tidak bisa memakai voucher (`ResellerVoucherNotAllowedError`), jadi tidak ada tumpukan reseller + voucher.
- Tier membership dipilih dari ambang tertinggi yang terpenuhi, meski tabel per-depot tidak berurutan.

## Temuan
| # | Temuan | Bukti | Dampak | Status |
|---|---|---|---|---|
| E-1 | Komentar `computeDiscount` bilang "floored", padahal kode membulatkan half-up | `voucher.ts` | Menyesatkan pembaca saja | **Diperbaiki** (komentar) |
| E-2 | Keranjang tidak menampilkan promo otomatis; harga baru turun saat checkout | `cart.service.ts` tidak punya referensi promo sama sekali; spec desain menulis promo dipanggil "saat cart di-price ulang" | Total di keranjang lebih tinggi dari total di checkout | Perlu keputusan |
| E-3 | Diskon persen reseller memakai `subtotal - tierPricedTotal`; `subtotal` sudah pasca-promo, `tierPricedTotal` masih pra-promo | `order.service.ts` memanggil `resellerDiscountFor(..., subtotal, tierPricedTotal)` setelah `applyPromoQuote`; promo tidak melewati baris harga-grosir | Kalau promo mengenai baris harga grosir, diskon reseller terlalu kecil (bisa 0). Hanya reseller persen + promo di baris grosir | Perlu keputusan |
| E-4 | Order langganan memakai diskon langganan saja, tanpa promo otomatis | `order.service.ts` sekitar baris 892 | Mungkin disengaja | Perlu keputusan |

## Opsi keputusan
- **E-2**: (a) keranjang ikut memanggil quote promo (fail-open, satu panggilan per tampilan keranjang); (b) biarkan, beri label "promo dihitung saat checkout"; (c) tidak ada tindakan.
- **E-3**: (a) promo tidak berlaku di baris harga grosir; (b) hitung ulang `tierPricedTotal` pasca-promo; (c) biarkan, dokumentasikan.
- **E-4**: (a) biarkan, langganan punya diskon sendiri; (b) langganan ikut promo otomatis.
