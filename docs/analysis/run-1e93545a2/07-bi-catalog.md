# Katalog KPI kandidat

Katalog ini menyebut grain, sumber dan batas perhitungan yang bisa ditelusuri dari source. Rumus dan akses lintas layanan perlu persetujuan owner sebelum dipakai sebagai angka resmi. Nilai tidak boleh diganti nol bila sumber gagal atau belum lengkap.

| ID | KPI / pemilik | Grain dan jendela | Sumber dan rumus kandidat | Batas / status |
|---|---|---|---|---|
| BI-KPI-01 | P&L depot / Finance HQ | depot × periode kalender | pendapatan order yang countsAsSale, COGS, payroll, opex dan refund dari dashboard-service `networkPnl`; laba = pendapatan − biaya − refund | PARTIAL: refund memakai `refundedAt` sedangkan penjualan memakai waktu order; refund order CANCELLED/VOIDED mungkin terhitung dua kali; cocokkan orderId dan status sebelum memakai angka (PLP-13) |
| BI-KPI-02 | SLA pengantaran / Operasional | delivery attempt atau order × hari; belum diputuskan | assignedAt sampai deliveredAt; status on-time mengikuti aturan earning dan report delivery-service | PARTIAL: reassign mempertahankan assignedAt/slaAlertedAt. PO menentukan apakah SLA per order atau percobaan (DLV-02) |
| BI-KPI-03 | Poin/reward referral yang benar-benar masuk / CRM | referral × sisi reward | ledger loyalty dan intent referral yang cocok, bukan status QUALIFIED saja | BELUM TERSEDIA sebagai angka utuh: reward dapat gagal sesudah QUALIFIED; perlu intent dan rekonsiliasi (REF-01) |
| BI-KPI-04 | Penyelesaian efek order / Operasional | outbox event × topik × hari | jumlah PENDING/FAILED/DONE dibanding bukti penerimaan stok/poin/referral/waralaba | PARTIAL: DONE producer belum membuktikan efek receiver jika adapter fail-open (ORD-01) |
| BI-KPI-05 | Kualitas forecast / Perencanaan | feed cursor × run | jumlah page/order teringest, lag dan status incomplete terpisah dari EOF | PARTIAL: timeout/non-2xx sekarang dapat tampil seperti EOF normal (FCS-04) |
| BI-KPI-06 | Bruto pajak dan BPJS / HR dan akuntan | karyawan × masa payroll | payroll.gross sekarang BASE + ALLOWANCE; BONUS terpisah | KEPUTUSAN DIPERLUKAN: dasar PPh dan BPJS tidak otomatis sama; komponen variabel perlu keputusan akuntan (HR-04) |

Tidak ada kueri data produksi atau rekonsiliasi nilai aktual pada audit ini. Model dan deklarasi endpoint terindeks di `02-inventory.json`; bukti tiap kandidat berada di `recommendations.json`. Katalog sengaja tidak mengisi target, tren, atau denominator yang belum disahkan.
