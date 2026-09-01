#!/usr/bin/env bash
# What the code fixes could not: rows that were ALREADY wrong when the fix shipped.
#
#   bash scripts/report-damaged-rows.sh [--out FILE]
#
# Step 08 of the console-audit sweep. Every Kritis closed in PRs #416–#422 leaves rows
# behind that a code change cannot heal — a withdrawal debited with no payer, a depot whose
# bank account a form blanked, a claim that credited itself, a reward stock below zero, a
# subscription belonging to an account that asked to be forgotten. The "Perbaikan" column of
# the audit closed each path for tomorrow; money and data already wrong today were never
# named.
#
# READ ONLY, AND THERE IS NO WRITE MODE.
#
# Owner decision, 1 September 2026: a dry run and a report, with no `--apply` at all. A
# data-repair script that carries a write path is a script somebody eventually runs — and
# these five classes each need a human to decide what the right number IS, not a script that
# picks one. Every statement below is a SELECT; there is no UPDATE, DELETE or INSERT in this
# file, and `check-report-damaged-rows.test.sh` fails if one appears.
#
# Exit: 0 = ran (whether or not it found anything); 2 = cannot reach Postgres.
# Finding damaged rows is NOT a failure exit: this is a report, and a red tick would make
# somebody suppress it.
set -uo pipefail

CONTAINER="${PG_CONTAINER:-hydromart-postgres}"
PG_USER="${PG_USER:-hydromart}"
OUT=""
[ "${1:-}" = "--out" ] && OUT="${2:-}"

say() {
  echo "$1"
  [ -n "$OUT" ] && echo "$1" >> "$OUT"
}

if ! docker exec "$CONTAINER" true >/dev/null 2>&1; then
  echo "!! cannot reach Postgres container '$CONTAINER'. Set PG_CONTAINER, or run this on the box."
  exit 2
fi

[ -n "$OUT" ] && : > "$OUT"

say "# Baris yang sudah terlanjur rusak di produksi"
say ""
say "Dibuat $(date -u '+%Y-%m-%dT%H:%M:%SZ') oleh scripts/report-damaged-rows.sh (BACA SAJA)."
say ""
say "Tidak ada satu pun pernyataan tulis di berkas ini. Angka di bawah adalah pertanyaan"
say "untuk pemilik, bukan pekerjaan yang menunggu tombol."
say ""

# One query, one service DB. `-tAX` so the output is data and nothing else.
q() { docker exec "$CONTAINER" psql -tAX -U "$PG_USER" -d "hydromart_$1" -c "$2" 2>&1; }

# A class: heading, why it matters, the count, then up to ten example rows.
section() {
  local title="$1" db="$2" why="$3" count_sql="$4" sample_sql="$5"
  local n
  n="$(q "$db" "$count_sql" | tr -d '[:space:]')"
  say "## $title"
  say ""
  say "$why"
  say ""
  case "$n" in
    ''|*[!0-9]*)
      # A query that could not run is NOT zero. Reporting it as zero is how a class of
      # damage disappears from a report somebody trusts.
      say "    TIDAK TERBACA: $n"
      ;;
    0)
      say "    0 baris."
      ;;
    *)
      say "    $n baris."
      say ""
      say "Contoh (maksimal 10):"
      say ""
      q "$db" "$sample_sql" | while IFS= read -r line; do say "    $line"; done
      ;;
  esac
  say ""
}

section \
  "Penarikan saldo tanpa pembayar (kurir)" \
  payout \
  "PR #417 memberi PROCESSING jalan keluar. Baris ini dibuat SEBELUM itu: saldonya sudah
didebit dan tidak ada yang pernah bisa menyatakan transfernya berhasil atau gagal. Untuk
tiap baris, pertanyaannya satu: uangnya sudah sampai atau belum?" \
  "SELECT count(*) FROM courier_withdrawals WHERE status = 'PROCESSING';" \
  "SELECT reference || ' | ' || \"courierId\" || ' | Rp' || amount || ' | ' || \"createdAt\"::date FROM courier_withdrawals WHERE status = 'PROCESSING' ORDER BY \"createdAt\" LIMIT 10;"

section \
  "Pencairan saldo tanpa pembayar (pemilik waralaba)" \
  payout \
  "Sisi yang sama, buku yang berbeda. Penyangkal audit sendiri sudah menamainya, dan #417
menutup keduanya sekaligus — tapi baris lamanya tetap di sini." \
  "SELECT count(*) FROM withdrawals WHERE status = 'PROCESSING';" \
  "SELECT reference || ' | ' || \"franchiseOwnerId\" || ' | Rp' || amount || ' | ' || \"createdAt\"::date FROM withdrawals WHERE status = 'PROCESSING' ORDER BY \"createdAt\" LIMIT 10;"

section \
  "Depot tanpa tujuan pembayaran" \
  depot \
  "PR #416 menutup jalannya: seorang manajer bisa menulis rekening bank SETIAP depot lewat
PATCH /depots/:id, dan halaman detail HQ menyimpan proyeksi publik yang tidak memuat
rekening — jadi menyimpan formulirnya mengosongkannya. Depot aktif tanpa rekening DAN tanpa
QRIS tidak bisa menerima transfer sama sekali." \
  "SELECT count(*) FROM depots WHERE active = true AND (\"paymentBankAccountNumber\" IS NULL OR \"paymentBankAccountNumber\" = '') AND (\"paymentQrisImageUrl\" IS NULL OR \"paymentQrisImageUrl\" = '');" \
  "SELECT code || ' | ' || name || ' | bank=' || coalesce(\"paymentBankAccountNumber\",'-') || ' | qris=' || CASE WHEN \"paymentQrisImageUrl\" IS NULL THEN '-' ELSE 'ada' END FROM depots WHERE active = true AND (\"paymentBankAccountNumber\" IS NULL OR \"paymentBankAccountNumber\" = '') AND (\"paymentQrisImageUrl\" IS NULL OR \"paymentQrisImageUrl\" = '') ORDER BY code LIMIT 10;"

section \
  "Klaim biaya yang menyetujui dirinya sendiri" \
  payout \
  "PR #418 dan #422 menutup dua celah di jalur ini: depot diambil dari body permintaan, dan
'ada struk' hanya berarti string tidak kosong. Baris di bawah disetujui OTOMATIS (tanpa
peninjau) dan mengkredit ledger kurir. Yang perlu diperiksa: apakah struknya nyata." \
  "SELECT count(*) FROM expense_claims WHERE status = 'APPROVED' AND \"reviewedBy\" IS NULL;" \
  "SELECT id || ' | ' || \"courierId\" || ' | Rp' || amount || ' | struk=' || coalesce(\"receiptUrl\",'-') || ' | ' || \"createdAt\"::date FROM expense_claims WHERE status = 'APPROVED' AND \"reviewedBy\" IS NULL ORDER BY amount DESC LIMIT 10;"

section \
  "Stok hadiah di bawah nol" \
  loyalty \
  "Penukaran mengurangi stok tanpa predikat stock > 0, sementara debit poin di transaksi yang
sama punya penjaganya. Stok negatif berarti hadiah yang sudah dijanjikan ke lebih banyak
orang daripada yang ada." \
  "SELECT count(*) FROM reward_items WHERE stock < 0;" \
  "SELECT id || ' | ' || name || ' | stok=' || stock FROM reward_items WHERE stock < 0 ORDER BY stock LIMIT 10;"

# Cross-database on purpose: the account lives in auth, the standing instruction lives in
# order, and neither knows about the other. That gap IS the finding.
DELETED="$(q auth "SELECT string_agg('''' || id || '''', ',') FROM customers WHERE status = 'DELETED';" | tr -d '[:space:]')"
say "## Langganan milik akun yang sudah dihapus"
say ""
say "PR #419 membatalkan langganan saat penghapusan disetujui. Baris ini dibuat sebelumnya:"
say "akunnya sudah dianonimkan dan langganannya masih ACTIVE, jadi sapuan malam masih"
say "menempatkan pesanan atas nama orang yang minta dilupakan."
say ""
if [ -z "$DELETED" ] || [ "$DELETED" = "" ]; then
  say "    0 akun berstatus DELETED — tidak ada yang perlu disilangkan."
else
  N="$(q order "SELECT count(*) FROM subscriptions WHERE status = 'ACTIVE' AND \"customerId\"::text IN ($DELETED);" | tr -d '[:space:]')"
  case "$N" in
    ''|*[!0-9]*) say "    TIDAK TERBACA: $N" ;;
    0) say "    0 baris." ;;
    *)
      say "    $N baris."
      say ""
      say "Contoh (maksimal 10):"
      say ""
      q order "SELECT id || ' | ' || \"customerId\" || ' | ' || \"productName\" || ' | berikutnya ' || \"nextDeliveryAt\"::date FROM subscriptions WHERE status = 'ACTIVE' AND \"customerId\"::text IN ($DELETED) ORDER BY \"nextDeliveryAt\" LIMIT 10;" \
        | while IFS= read -r line; do say "    $line"; done
      ;;
  esac
fi
say ""

say "---"
say ""
say "Tidak ada baris yang diubah. Apa yang harus terjadi pada setiap kelompok di atas adalah"
say "keputusan pemilik, dan setiap keputusan itu butuh angka yang benar — bukan tebakan skrip."
[ -n "$OUT" ] && echo "" && echo "Laporan ditulis ke $OUT"
exit 0
