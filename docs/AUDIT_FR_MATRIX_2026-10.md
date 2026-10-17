# Matriks FR PRD × kode × uji — audit pra-rilis 2026-10-17

Sumber FR: `docs/PRD.docx` §14 (FR-001..FR-100). Dibuat dari pencarian kode terarah lalu dibaca untuk FR yang ambigu; **bukan** hasil uji penerimaan.

**Status kode** terhadap PRD: ADA / ADA (stub) / SEBAGIAN / BELUM / DIHAPUS / BERBEDA / TIDAK BERLAKU.
**Uji**: `E` = dijalankan lewat API/E2E pada stack lokal; `B` = browser (Playwright/APK); `P` = halaman dibuka per role tanpa error konsol/request gagal (isi data tidak diverifikasi); `-` = tidak dijalankan. Kolom Uji kosong/`-` berarti **TIDAK TERVERIFIKASI** secara runtime.

## Module 1 — Authentication

| FR | Fitur (PRD) | Status kode | Bukti kode | Uji |
|---|---|---|---|---|
| FR-001 | User dapat registrasi menggunakan nomor HP. | ADA | `apps/web/src/lib/endpoints/identity.ts` | E,B |
| FR-002 | OTP dikirim melalui SMS/WhatsApp. | ADA | `services/auth-service/src/config/auth-config.service.ts` | E (kanal konsol; SMS/WA nyata tidak diuji) |
| FR-003 | OTP berlaku 5 menit. | ADA | `services/auth-service/src/application/ports/otp-token.repository.ts` | E (log "valid 300s") |
| FR-004 | OTP hanya dapat digunakan sekali. | ADA | `services/auth-service/src/application/ports/otp-token.repository.ts` | E |
| FR-005 | Login menggunakan nomor HP. | ADA | `services/auth-service/src/modules/auth/auth.controller.ts` | E,B |
| FR-006 | Login menggunakan Google. | DIHAPUS | Login Google dihapus dengan sengaja; login.service.ts: "Google Sign-In was removed — phone/OTP is the sole path". | - |
| FR-007 | Forgot Password. | TIDAK BERLAKU | Tidak ada password: login hanya HP + OTP, jadi tidak ada yang di-reset. | - |
| FR-008 | Logout. | ADA | `apps/web/src/lib/auth-context.tsx` | P |
| FR-009 | Session timeout. | ADA | `services/auth-service/src/application/ports/refresh-token.repository.ts` | - |
| FR-010 | Multi-device login management. | ADA | `apps/web/src/app/account/page.tsx` | - |

## Module 2 — Customer Profile

| FR | Fitur (PRD) | Status kode | Bukti kode | Uji |
|---|---|---|---|---|
| FR-011 | Edit Profile | ADA | `apps/web/src/app/account/edit/change-phone.tsx` | - |
| FR-012 | Multiple Address | ADA | `services/customer-service/src/modules/address.controller.ts` | P |
| FR-013 | Favorite Depot | ADA | `apps/web/src/app/account/page.tsx` | P |
| FR-014 | Membership Status | ADA | `apps/web/src/app/account/page.tsx` | P |
| FR-015 | Point Balance | ADA | `apps/web/src/app/hq/customers/page.tsx` | E |
| FR-016 | Voucher List | ADA | `apps/web/src/app/vouchers/page.tsx` | P |
| FR-017 | Notification Preference | ADA | `apps/web/src/app/account/page.tsx` | P |
| FR-018 | Delete Account | ADA | `apps/web/src/app/account/page.tsx` | P |

## Module 3 — Product Catalog

| FR | Fitur (PRD) | Status kode | Bukti kode | Uji |
|---|---|---|---|---|
| FR-019 | List seluruh produk. | ADA | `services/product-service/src/modules/product.controller.ts` | E,B |
| FR-020 | Search produk. | ADA | `apps/web/src/components/app-bar.tsx` | B |
| FR-021 | Kategori produk. | ADA | `services/product-service/src/application/services/category.service.ts` | P |
| FR-022 | Harga per depot. | ADA | `services/depot-service/src/application/ports/inventory.repository.ts` | E |
| FR-023 | Promo produk. | ADA | `services/promo-service/src/application/ports/promo-rule.repository.ts` | - |
| FR-024 | Produk tersedia/tidak. | ADA | `services/product-service/src/application/ports/category.repository.ts` | E |
| FR-025 | Estimasi delivery. | ADA | `services/order-service/src/application/ports/order.repository.ts` | - |
| FR-026 | Stock availability. | ADA | `services/depot-service/src/application/ports/inventory.repository.ts` | E |

## Module 4 — Shopping Cart

| FR | Fitur (PRD) | Status kode | Bukti kode | Uji |
|---|---|---|---|---|
| FR-027 | Tambah produk | ADA | `services/order-service/src/modules/cart.controller.ts` | E,B |
| FR-028 | Edit Qty | ADA | `services/order-service/src/modules/cart.controller.ts (PUT items/:productId)` | - |
| FR-029 | Delete Item | ADA | `services/order-service/src/modules/cart.controller.ts` | - |
| FR-030 | Voucher | ADA | `services/order-service/src/application/ports/franchise-revenue.port.ts` | - |
| FR-031 | Promo | ADA | `services/order-service/src/application/ports/product-catalog.port.ts` | - |
| FR-032 | Membership Discount | ADA | `services/order-service/src/application/ports/membership.port.ts` | - |
| FR-033 | Delivery Fee | ADA | `services/order-service/src/application/ports/depot-directory.port.ts` | E |
| FR-034 | Tax Calculation | SEBAGIAN | Pengaturan PPN (priceIncludesTax) ada di payment-service dan dipakai template invoice HQ; belum ditemukan perhitungan pajak di total order/keranjang. | - |

## Module 5 — Checkout

| FR | Fitur (PRD) | Status kode | Bukti kode | Uji |
|---|---|---|---|---|
| FR-035 | Konfirmasi alamat | ADA | `services/order-service/src/application/ports/customer-directory.port.ts` | E,B |
| FR-036 | Pilih jadwal | SEBAGIAN | Slot pengiriman per depot ada (order.service deliverySlots); komentar checkout/page.tsx:86 menyebut kolom scheduledFor per-order belum ada. | - |
| FR-037 | Pilih pembayaran | ADA | `services/payment-service/src/application/ports/payment-gateway.port.ts` | E,B |
| FR-038 | Catatan customer | ADA | `services/order-service/src/application/ports/order.repository.ts` | E |
| FR-039 | Review order | ADA | `apps/web/src/app/checkout/page.tsx` | B |
| FR-040 | Submit order | ADA | `services/order-service/src/modules/order.controller.ts` | E,B |

## Module 6 — Payment

| FR | Fitur (PRD) | Status kode | Bukti kode | Uji |
|---|---|---|---|---|
| FR-041 | Cash | ADA | `services/payment-service/src/application/ports/cashier-shift.port.ts` | E |
| FR-042 | Transfer | ADA | `services/payment-service/src/application/ports/payment-gateway.port.ts` | - |
| FR-043 | QRIS | ADA | `services/payment-service/src/application/ports/payment-gateway.port.ts` | E |
| FR-044 | E-Wallet | ADA (stub) | Metode EWALLET ada; gateway nyata tidak terhubung (komponen stub di stack test, pembayaran langsung ke depot). | E (webhook bertanda tangan, stub) |
| FR-045 | Virtual Account | ADA (stub) | Metode VA ada di enum dan UI; tidak ada provider nyata (lihat catatan E-Wallet). | - |
| FR-046 | Payment Confirmation | ADA | `services/payment-service/src/application/services/payment.service.ts` | E |
| FR-047 | Refund | ADA | `services/payment-service/src/application/ports/order-coordination.port.ts` | - |
| FR-048 | Payment History | ADA | `apps/web/src/app/orders/detail/page.tsx` | P |

## Module 7 — Order Management

| FR | Fitur (PRD) | Status kode | Bukti kode | Uji |
|---|---|---|---|---|
| FR-049 | Create Order | ADA | `services/order-service/src/application/ports/customer-directory.port.ts` | E,B |
| FR-050 | Update Order | ADA | `services/order-service/src/modules/order.controller.ts` | E |
| FR-051 | Cancel Order | ADA | `services/order-service/src/application/ports/inventory.port.ts` | E |
| FR-052 | Reschedule | BELUM | Hanya notifikasi RESCHEDULED dari sisi delivery; tidak ada alur customer menjadwal ulang order. | - |
| FR-053 | Repeat Order | ADA | `apps/web/src/app/orders/detail/page.tsx` | - |
| FR-054 | Track Order | ADA | `apps/web/src/app/track/page.tsx` | P |
| FR-055 | Order Timeline | ADA | `apps/web/src/components/app-bar.tsx` | P |
| FR-056 | Order History | ADA | `services/order-service/src/modules/cart.controller.ts` | E,P |

## Module 8 — Delivery

| FR | Fitur (PRD) | Status kode | Bukti kode | Uji |
|---|---|---|---|---|
| FR-057 | Assign Driver | ADA | `services/delivery-service/src/application/ports/delivery.repository.ts` | E |
| FR-058 | Accept Delivery | ADA | `services/delivery-service/src/application/ports/delivery.repository.ts` | - |
| FR-059 | Navigation | ADA | `apps/web/src/app/driver/deliveries/detail/page.tsx` | - |
| FR-060 | Pickup | ADA | `services/delivery-service/src/application/services/delivery.service.ts` | E |
| FR-061 | On Delivery | ADA | `services/delivery-service/src/application/ports/delivery.repository.ts` | E |
| FR-062 | Arrived | ADA | `apps/web/src/app/driver/deliveries/detail/no-show/page.tsx` | - |
| FR-063 | Proof of Delivery | ADA | `services/delivery-service/src/application/ports/delivery.repository.ts` | E |
| FR-064 | Signature | ADA | `apps/web/src/components/driver/pod-capture.tsx` | - |
| FR-065 | Photo Delivery | ADA | `services/delivery-service/src/application/ports/delivery.repository.ts` | - |
| FR-066 | Complete | ADA | `services/delivery-service/src/application/ports/courier-payout.port.ts` | E |

## Module 9 — Inventory

| FR | Fitur (PRD) | Status kode | Bukti kode | Uji |
|---|---|---|---|---|
| FR-067 | Stock Air | ADA | `services/depot-service/src/application/ports/depot.repository.ts` | E |
| FR-068 | Stock Galon | ADA | `services/depot-service/src/application/ports/customer-notification.port.ts` | - |
| FR-069 | Stock Tutup | SEBAGIAN | Stok dikelola per produk (inventory per depot); tidak ada jenis stok "tutup" terpisah dari produk. | - |
| FR-070 | Stock Segel | SEBAGIAN | Idem FR-069 untuk "segel". | - |
| FR-071 | Stock Produk | ADA | `services/depot-service/src/application/ports/depot.repository.ts` | E |
| FR-072 | Stock Adjustment | ADA | `services/depot-service/src/application/ports/inventory.repository.ts` | - |
| FR-073 | Stock Opname | ADA | `apps/web/src/app/dashboard/approvals/detail/page.tsx` | - |
| FR-074 | Low Stock Alert | ADA | `services/depot-service/src/application/ports/inventory.repository.ts` | P |

## Module 10 — Depot Management

| FR | Fitur (PRD) | Status kode | Bukti kode | Uji |
|---|---|---|---|---|
| FR-075 | Kelola Depot | ADA | `services/depot-service/src/modules/depot.controller.ts` | E,P |
| FR-076 | Jam Operasional | ADA | `apps/web/src/app/checkout/page.tsx` | - |
| FR-077 | Area Delivery | ADA | `services/depot-service/src/application/ports/depot.repository.ts` | E |
| FR-078 | Delivery Radius | ADA | `services/depot-service/src/application/ports/depot.repository.ts` | E |
| FR-079 | Delivery Fee | ADA | `services/depot-service/src/application/ports/depot.repository.ts` | E |
| FR-080 | Holiday Setting | ADA | `apps/web/src/app/checkout/page.tsx` | - |

## Module 11 — Franchise Management

| FR | Fitur (PRD) | Status kode | Bukti kode | Uji |
|---|---|---|---|---|
| FR-081 | Tambah Franchise | ADA | `services/depot-service/src/application/ports/franchise-application.repository.ts` | P |
| FR-082 | Monitoring Franchise | ADA | `services/dashboard-service/src/application/ports/dashboard-sources.port.ts` | P |
| FR-083 | Royalty | SEBAGIAN | Diimplementasikan sebagai platformFeePct (bagian HQ dari penjualan waralaba); status akuntansi/pajaknya masih pertanyaan terbuka di docs/BRIEF_AKUNTAN.md. | - |
| FR-084 | Performance | ADA | `services/delivery-service/src/application/ports/delivery.repository.ts` | P |
| FR-085 | Sales Report | ADA | `services/order-service/src/application/ports/order.repository.ts` | P |
| FR-086 | Audit | ADA | `services/admin-service/src/application/ports/purge-executor.port.ts` | P |

## Module 12 — CRM

| FR | Fitur (PRD) | Status kode | Bukti kode | Uji |
|---|---|---|---|---|
| FR-087 | Customer Segmentation | ADA | `services/crm-service/src/application/ports/activity-segment.port.ts` | P |
| FR-088 | Campaign | ADA | `services/crm-service/src/app.module.ts` | P |
| FR-089 | Coupon | ADA | `services/promo-service/src/application/ports/customer-lookup.port.ts` | P |
| FR-090 | Voucher | ADA | `services/promo-service/src/application/ports/customer-lookup.port.ts` | P |
| FR-091 | Birthday Promo | ADA | `services/loyalty-service/src/modules/loyalty.controller.ts` | - |
| FR-092 | Referral | ADA | `services/referral-service/src/app.module.ts` | P |
| FR-093 | Push Notification | ADA | `services/crm-service/src/application/ports/broadcast-delivery.port.ts` | P |
| FR-094 | WhatsApp Broadcast | BERBEDA | Transport WhatsApp (WABA) dihapus (broadcast-delivery.port.ts); broadcast sekarang lewat inbox + web push. | - |

## Module 13 — Reporting

| FR | Fitur (PRD) | Status kode | Bukti kode | Uji |
|---|---|---|---|---|
| FR-095 | Daily Sales | ADA | `services/order-service/src/application/ports/depot-directory.port.ts` | P |
| FR-096 | Monthly Sales | ADA | `services/dashboard-service/src/application/ports/dashboard-sources.port.ts` | P |
| FR-097 | Top Customer | ADA | `services/dashboard-service/src/application/ports/dashboard-sources.port.ts` | P |
| FR-098 | Top Depot | ADA | `services/dashboard-service/src/application/ports/dashboard-sources.port.ts` | P |
| FR-099 | Delivery SLA | ADA | `services/dashboard-service/src/application/ports/dashboard-sources.port.ts` | P |
| FR-100 | Executive Dashboard | ADA | `services/dashboard-service/src/application/ports/dashboard-sources.port.ts` | P |

## Ringkasan

- ADA: 89
- DIHAPUS: 1
- TIDAK BERLAKU: 1
- SEBAGIAN: 5
- ADA (stub): 2
- BELUM: 1
- BERBEDA: 1
- Diuji runtime (E/B/P): 66 dari 100; sisanya TIDAK TERVERIFIKASI secara runtime.
