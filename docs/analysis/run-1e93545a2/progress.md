# progress.md — Hydromart Development Opportunities Audit
Run dir: docs/analysis/run-1e93545a2 (docs/analysis/ root held only a stub: baseline-status.txt, manifest-tracked.txt — left untouched)
Baseline: HEAD 1e93545a23b3c66ab2a33da949a371406030ccd1, branch main, 2026-10-31 14:29 +0700
Tracked files: 4062. Fingerprint (sha256 over path+content hash): see baseline.json
Dirty state before audit: untracked docs/analysis/ (stub) and mobile-release-1.14.1/ (RELEASE_NOTES.md). No tracked-file modifications.
Local instructions: CLAUDE.md/AGENTS.md demand "continue implementation" — conflicts with read-only audit; audit prompt scope wins (user-authored, current).
Owners (from scripts/baseline.py): 18 services, apps/web, packages/{platform,access}, mobile, scripts, docs, .uat, ops, infra, .github, .claude, test, root.
## Phase log
- [A1] baseline.json + 01-file-ledger.seed.json created (4060 UNREAD, 2 BLOCKED: env-backup-public.pem, scripts/generate-secrets.sh? see ledger)
## Next
- Phase A2 context (00-context.md) -> Phase B extraction -> Phase C agents per owner -> D..H -> final report + HTML
- [C] 14 subagent dispatched 2026-10-31 (background): depot, hr, order, admin, auth-gateway-access, delivery, customer-referral, crm-reco-forecast, payout-payment, promo-loyalty-product-dashboard, apps-web-app, apps-web-other, mobile-platform, infra-docs. Output -> agents/<owner>/{ledger.json,findings.md,inventory.*,search-log.md,unresolved.md,handoff.md}. Brief: AGENT_BRIEF.md
- Note: seed ledger marks .env.production.example BLOCKED (false positive: it is an example, key names readable); ops/env-backup-public.pem stays BLOCKED.
## Next (after all 14 return)
1 merge ledgers vs seed (exactly one status/owner per path) -> 01-file-ledger.md/json
2 00-context.md from infra-docs DEC/PREV; 02-inventory from agents inventory.json (counts programmatic)
3 03 flows, BI catalog, automation; re-read evidence for top findings + all Quick Wins; 15-sample spot-check seeded from HEAD
4 05-verification, 06-duplicate-check, 04-search-log merge, final MD + self-contained HTML; verify HEAD/fingerprint unchanged (baseline.json)
- [C] delivery-service DONE (findings.md written by main; agent Write was refused). 13 other agents resumed 16:10 after 5h rate-limit reset. Agents told to write via Bash.
- [C] depot-service first pass: 72 READ/1 SKIPPED/301 UNREAD, 18 findings (DEP-01..18). Follow-up sent to read remaining 301.
- [C] payout-payment DONE: 222 READ (83 FULL, 139 STRUCTURED-SCAN)/0/0/0, 17 findings PPA-01..17 (top: PPA-01 stale pending sweep, PPA-02 single-actor payout settle, PPA-03/05 refund no money-out + franchise ledger not reversed).
- [C] apps-web-app first pass: 5 READ/264 STRUCTURED-SCAN/2 SKIPPED, 250 unique routes, 723 api.* calls (45 unauth, all in allowlist), findings APP-01..05. Follow-up sent: read big pages + resolve APP-05.
- [C] apps-web-other first pass: 47 READ/5 SKIPPED/627 UNREAD, WEB-01..12 (top WEB-01 native logout w/o bearer, WEB-03 offline queue drops >7d money jobs, WEB-12 idempotency only 5 paths). Follow-up sent for remaining.
- [C] promo-loyalty-product-dashboard first pass: 44 READ/6 PARTIAL/134 SCANNED/39 SKIPPED/64 UNREAD, PLP-01..12 (top PLP-01 voucher not released on online cancel, PLP-04 MANAGER voucher write w/o depot ownership check, PLP-03/05 KPI counting released/cancelled). Follow-up sent.
- [C] customer-referral DONE: 135 READ/66 SKIPPED/0/0 (merge note: 45 test files SKIPPED but STRUCTURED-SCAN of titles only -> reclassify READ(structured, titles only) or UNREAD at merge; rollback.sql/migration_lock ok SKIP). 19 findings REF-01..05, CUS-01..14 (top REF-01 referral reward non-idempotent, REF-02 referral missing from PDP export/erase, CUS-01 PATCH address isPrimary 500).
- [C] infra-docs first pass: 31 READ/113 PARTIAL/27 SKIPPED/202 UNREAD, IDO-01..09 + DEC-01..25 + PREV-01..10 (top IDO-04 DB dump unencrypted to S3, IDO-05 SECURITY register stale, IDO-06 PPN doc conflict vs taxAmount in order schema, IDO-03 deploy.yml dispatch inputs interpolated to VPS shell - re-verify). Follow-up sent.
- [C] crm-reco-forecast first pass: 95 READ/151 UNREAD, 14 findings (CRM-01..06,FCS-01..04,REC-01..03,RET-01); follow-up sent. mobile-platform DONE: 90 READ/75 SKIPPED(44 are spec STRUCTURED-SCAN -> reclassify READ(structured) at merge)/0/0, PLT-01..12 (PLT-06 idempotency no shared helper, PLT-01 audit best-effort no outbox, PLT-12 SECURITY register stale). infra-docs follow-up in progress.
- [C] order-service first pass: 173 READ/2 PARTIAL/67 UNREAD, ORD-01..17 (top ORD-01 outbox DONE though downstream fail-open for 4/7 topics, ORD-06 counter sale COMPLETED before payment, ORD-04/05/03). Follow-up sent.
- [C] auth-gateway-access DONE: 77 READ/131 STRUCTURED-SCAN(READ)/23 SKIPPED/0/0, 11 findings (AUT-01 role downgrade of existing SUPER_ADMIN etc, AUT-02 no consent rows on login-created accounts, GW-04 BFF drops client IP/UA). hr-service first pass: 87 READ/14 PARTIAL/164 SKIPPED(test+migration scanned)/76 UNREAD, HR-01..26 (HR-01 overtime auto-paid no approval/cap, HR-04 PPh21/BPJS base excludes bonus/overtime/THR, HR-21/23 PII export + anonymise incomplete). Follow-up sent. Awaiting: depot, hr, order, web-app, web-other, promo, crm, infra follow-ups + admin-service first report.
- [C] admin-service DONE: 81 READ/157 STRUCTURED-SCAN/0/0/0, AAS-01..16 (AAS-04 scheduled-report recipients unvalidated, AAS-08 no retention for export_logs/webhook/tickets/fraud_flags, AAS-01..03 fraud flag block/clear races). NOTE: admin-service has NO franchise/royalty/settlement/dispute/approval -> locate in depot-service/payout (open for flows). Remaining agents running: depot, hr, order, web-app, web-other, promo, crm, infra.
- [C] 2nd rate limit hit; 8 agents (depot, hr, order, web-app, web-other, promo, crm, infra) stopped mid follow-up; resets 21:10 +0700. Resume via SendMessage 'continue follow-up from where you stopped'.
- [C] apps-web-app follow-up DONE: 6 READ/263 STRUCTURED-SCAN(+ranges)/2 SKIPPED/0 UNREAD. APP-05 closed (server dedup verified for 9 mutations). Findings APP-01,02,03,04,06,07 (APP-06 rewards redeem new randomUUID per call defeats dedup; APP-02 inventory.adjust delta no dedup; APP-07 cashbook.create/loyalty.adjust no dedup). Correction: opname NOT keyed in FE; safe because diff vs count. Still not content-read: account, hr/*, m/manager/*, driver/*, dashboard/deliveries -> candidate extra pass. NOTE final report must separate READ(full) vs STRUCTURED-SCAN honestly.
- [C] apps-web-other round2: ledger 393 READ(55 full + 338 STRUCTURED-SCAN tests)/5 SKIPPED/281 UNREAD (200 PATTERN-SCAN only components/lib -> keep UNREAD; 81 dictionaries/endpoints/types/hr.ts/config). WEB-01..15 (new: WEB-13 device-local day escapes tz gate, WEB-14 localStorage w/o try-catch crashes app, WEB-15 raw String(err) toast). Accept as UNREAD in final -> PARTIAL.
- [C] promo-loyalty-product-dashboard DONE: 216 READ(44 full,134 STRUCTURED,6 validator-scan,32 manual-filtered)/71 SKIPPED/0/0. MERGE NOTE: 32 of the SKIPPED are bootstrap files only grep-patterned (main, app.module, health...) -> invalid SKIP; reclassify UNREAD(pattern-scan). PLP-01..13; PLP-01 final OPEN (PAYMENT_REVERSAL handler order.service.ts:363-368 doesn't release voucher; only 2 callers of promo.release); PLP-13 new: network-pnl refunds double-counted (ASSUMPTION).
- [C] crm DONE (205 READ[120 full+85 structured]/41 SKIPPED/0/0; 17 findings; cadence: campaign sweep every 2min, REORDER_REMINDER daily 08:00 limit 500 -> RET-01 FINAL, CRM-01 downgraded to 3). depot round2: 248 READ/1 SKIPPED/125 UNREAD, DEP-01..33. infra-docs round2: 346 READ(32 full,2 docx,312 shallow pattern-scan)/26 SKIPPED/1 BLOCKED/0 UNREAD, IDO-01..11, DEC-01..25, PREV-01..11 (shallow scans = reclassify UNREAD at merge for logic claims). Remaining: hr, order still running.
- [D0] MERGED LEDGER (scripts/merge_ledger.py, strict rules; re-run after hr+order finish): 4062 paths, 1 status each, dup 0, missing 0. READ=1001, READ-STRUCTURED=1515 (tests/migrations/sql/json only), SCAN-SHALLOW=765 (pattern-only; counts as NOT read), SKIPPED=215, BLOCKED=1 (ops/env-backup-public.pem), UNREAD=565. Gate FAILS -> final status PARTIAL. HEAD unchanged 1e93545a2, no tracked changes.
- Findings so far (local IDs): DLV 13, DEP 33, PPA 17, APP 6, WEB 15, PLP 13, REF/CUS 19, CRM/FCS/REC/RET 17, PLT 12, AUT/GW 11, AAS 16, IDO 11 (+DEC 25, PREV 11), ORD 17+, HR 26+.
## Remaining plan
1 wait hr+order -> rerun merge
2 write 00-context.md (from agents/infra-docs findings DEC/PREV + roles from auth-gateway-access), 02-inventory.md (merge agents inventory.json, counts programmatic), 04-search-log.md (concat), 03 flows, BI catalog, automation
3 final report HYDROMART_DEVELOPMENT_OPPORTUNITIES.md: global ids FTR/FLW/BI/AUT mapped from local ids; re-open evidence for all impact>=4 + Quick Wins; spot-check 15 (seed from HEAD)
4 05-verification, 06-duplicate-check, HTML (no CDN), validation, final HEAD/fingerprint compare
- [C] hr-service DONE: 339 READ (166 manual,9 controllers,164 STRUCTURED tests/migrations/TER json)/2 SKIPPED/0/0; HR-01..30 (new HR-27 HR can link employee to any auth account via authSubjectId; HR-28 face verifier stub allowed in prod; HR-29 unscoped rules ASSUMPTION; HR-30 .env.example incomplete). Tests do not close HR-01/04/21/23. Only order-service still running.
- [C] order-service DONE: 241 READ(111 full,130 structured)/1 SKIPPED/0/0; ORD-01..22 (ORD-01 verified: 4 of 7 outbox topics DONE though downstream fail-open; crons found in scripts/scheduler/crontab). ALL 14 agents returned. Open UNREAD: depot 125, web-other 281.
- [FINAL] report built: HYDROMART_DEVELOPMENT_OPPORTUNITIES.md/.html, 00/01/02/04/05/06 written. Status PARTIAL. HEAD+fingerprint unchanged. 236 findings, QW computed.
- [R3] option 1 chosen by user: worklists/<agent>.json = files still UNREAD/SCAN-SHALLOW; resuming agents to read them fully.
- [R3] limit reset 03:30; at 08:37 all 11 round-3 agents resumed (worklists/*.json). After they return: rerun scripts merge_ledger -> parse_findings -> verify_cites -> build_report -> build_html, recompare HEAD/fingerprint.
- [R3] delivery-service round3 DONE: 27 files read; ledger 97 FULL/86 STRUCTURED/9 SKIPPED/0/0; new DLV-14..17 appended by main to findings.md; U-08 (isRetryable on 422).

## Resume 2026-11-03 (Asia/Jakarta)

- Menjalankan `scripts/assemble.py` atas keputusan resume. Ledger akhir: 4.062 path, 1.268 READ, 2.712 UNREAD, 81 SKIPPED, 1 BLOCKED. Rekomendasi teradjudikasi: 70 (12 FTR, 25 FLW, 7 BI, 26 AUT); 4 kandidat digabung, 1 ditutup.
- Mengisi `03-cross-service-flows.md`, `07-bi-catalog.md`, dan `08-automation.md` dengan batas STATIC serta sumber keputusan di `recommendations.json`; laporan Markdown dan HTML dirakit ulang.
- Memperbaiki pembacaan `review-ranges.json` berulang pada assembler dan filter matriks HTML untuk skema kolom baru. HTML memiliki 70 baris matriks; ID rekomendasi, ID lokal, 11 section, dan KPI setara dengan Markdown; tanpa CDN.
- `05-verification.json`: HEAD dan fingerprint baseline identik, drift 0, referensi bukti keputusan tidak invalid. Sampel 15 keputusan tersimpan di `05-spot-check.json`. Tidak ada tes aplikasi, akses runtime/DB, commit, atau perubahan source tracked sesuai lingkup audit baca-saja.
- Status tetap PARTIAL: 2.712 file UNREAD dan satu PEM BLOCKED. Pembacaan lama yang hanya scan tidak dipromosikan menjadi READ. Inspeksi visual HTML dan verifikasi semantik seluruh kandidat historis belum dilakukan.

## Lanjutan verifikasi 2026-11-03

- Memeriksa ulang 15 sampel reproducible terhadap source yang dikutip; hasil dan batas tiap sampel dicatat di `resume/primary/spot-check-review.json` dan digabung ke `05-spot-check.json`/`05-verification.md`. Ini verifikasi source pada klaim terbatas, bukan tes runtime.
- APP-02 dinaikkan dari `defer-evidence` menjadi `keep` setelah membaca caller web, controller, service, repository, dan constraint `StockMovement`: adjustment delta tidak punya attempt key dan tiap request membuat movement baru. Klaim dibatasi pada retry dengan jawaban hilang; tidak ada bukti duplikasi produksi.
- Merakit ulang Markdown/HTML; tetap 70 rekomendasi. Cek terprogram lulus untuk 15 hasil sampel, path/baris bukti, fingerprint baseline, kesetaraan ID/section/KPI, dan 70 baris matriks HTML. Status cakupan tidak berubah: PARTIAL.
- Membuka HTML lokal di Chrome: filter ID `FLW-001` mengembalikan tepat satu baris dan reset 70; tidak ada console error/warning/issue. Pada viewport mobile 390px ditemukan overflow dari path bukti panjang, lalu CSS `overflow-wrap` diperbaiki. Pemeriksaan ulang: lebar dokumen 390px, matriks 1200px bergulir di kontainer 350px. Hasil dan hash artefak tersimpan di `05-browser-check.json`/`05-artifact-verification.json`.

## Audit repositori penuh 2026-11-03

- `scripts/full_scan.py` membaca seluruh 4.062 file tracked (31.581.497 byte) dan mencocokkan SHA-256 baseline: 4.002 teks struktural, 60 biner diinspeksi, 0 error. PEM publik valid; ledger baru `01-full-coverage.csv`. Status UNREAD/BLOCKED pada checkpoint lama tidak berlaku untuk cakupan pemindaian baru.
- AST JS/TS/TSX tanpa parse diagnostic; 105 skrip shell dan 23 YAML valid. Typecheck, lint, 16 validasi schema Prisma, dan build seluruh workspace lulus pada Node 25/npm 11 lokal, di luar rentang versi repo.
- `npm run test` gagal default hanya pada `auth.e2e.spec.ts`: import `AppModule` meminta `AUTH_DATABASE_URL` sebelum stub config. Suite tersebut lulus 5/5 dengan env tes sementara. Web lulus 2.767/2.767 tes. `test:integration` terhalang Docker daemon. Android native terhalang SDK/JAVA_HOME.
- `audit:ci` keluar 0 saat permintaan advisory `npm audit` gagal. Temuan baru `IDO-12`/`AUT-027` ditambahkan; status kerentanan aktual belum dapat dinyatakan aman.
- Dua kandidat lama tanpa bukti (`DEP-04`, `WEB-09`) diperiksa ulang dan diberi bukti source, tetap ditunda untuk keputusan kebijakan atau skenario browser. `HYDROMART_FULL_AUDIT.md` berisi 71 entri dan 12 gate. HTML memiliki 71 detail/baris matriks dan 8 bagian, filter diuji di Chrome.
- Source aplikasi dan commit tidak diubah; laporan sebelumnya tetap arsip checkpoint PARTIAL.

## Verifikasi Docker dan data lokal 2026-11-03

- Docker Desktop 29.7.2 berjalan; stack Compose `hydromart` lokal dengan volume PostgreSQL persisten ditemukan. 19 aplikasi sehat, scheduler `unhealthy`. Tidak ada operasi tulis database dalam verifikasi ini.
- Query `READ ONLY` mengonfirmasi record lokal: 73 order, 131 stock movement, 4 payment, 2 delivery, 60 customer auth, 69 profil customer, 260 akun loyalti, 32 karyawan. Data bertanggal 22 Oktober dan overlay `prodlike-sinks` menunjukkan asal produksi tidak dapat diklaim.
- Gateway `/health` dan web `/` HTTP 200. Katalog publik melaporkan 20 produk aktif, sama dengan hitungan PostgreSQL; `/auth/me` tanpa token HTTP 401.
- Scheduler log menunjukkan beberapa sweep HTTP 401. Perbandingan kesamaan kunci internal tanpa mencetak nilainya: scheduler satu kelompok, 18 backend/gateway kelompok lain. Heartbeat admin terakhir 2026-10-22 13:04; temuan operasional dan batasnya di `HYDROMART_DOCKER_DATA_VERIFICATION.md`.
- Harness `test:integration` tidak dijalankan pada volume yang ada karena menjalankan migrasi, seed, alur mutatif dan `compose down`; duplikat stack penuh juga berisiko pada Docker ~8,2 GB RAM. Laporan utama ditambah bagian 9 yang menautkan verifikasi runtime.

## Pemulihan scheduler dan integrasi terisolasi 2026-11-03

- Scheduler direkreasikan sendiri dengan Compose dan `.env` lokal yang kuncinya cocok dengan backend. Health kembali `healthy`, sweep `ok: true`, dan heartbeat admin bergerak maju. Stack aplikasi utama dan volume PostgreSQL tidak direkreasi.
- `test/integration/run.mjs` diperbaiki agar `postgres up` memakai overlay Compose yang sama dengan tahap lain serta meneruskan `PSQL_CONTAINER` dari konfigurasi project. Ini mencegah SQL payroll terisolasi menyasar `hydromart-postgres` milik stack utama.
- Project integrasi `hydromart-audit-20261103` memakai volume baru, PostgreSQL port 15432, dan gateway port 18080. Run pertama terputus saat build `payout` karena BuildKit EOF; image `payout` lulus saat diulang. Run kedua lulus semua flow/HRIS/approvals tetapi payroll gagal karena target container default; query tulis ke stack utama ditolak oleh foreign key. Run final exit 0: 20/20 service sehat, semua skenario inti, HRIS 23/0/3 skip, approvals 158/0, payroll semua lulus. Project tes diturunkan otomatis.

## Uji HRIS dan backlog 2026-11-04

- Overlay Compose tes kini menghidupkan MinIO dengan bucket `hr-docs`; fixture cuti memilih bulan payroll tertutup. Setelah command `storage-init` diperbaiki, harness integrasi penuh exit 0: 20/20 sehat, HRIS 30/0/0 skip, approvals 158/0, payroll manual lulus. Bukti di `isolated-integration-storage-retry.log`.
- Scheduler stack utama tetap sehat. Sweep expiry pada 2026-11-03 16:05 UTC melaporkan 5 order dibatalkan dan 2 stalled; jumlah order tetap 73 dan CANCELLED bertambah 66→71. Dari 22 job, 21 sukses terakhir dan `shifts/internal/remind-starting` gagal HTTP 404 berulang. Pemeriksaan ini baca-saja; asal produksi data tidak dibuktikan.

## Tindak lanjut 2026-11-04

- HTTP 404 job shift berasal dari image HR lama. Backup HR dibuat, satu migrasi aditif `shift_reminders_sent` diterapkan, dan hanya HR direkreasikan memakai image terbaru. `.env` lokal diselaraskan dengan kredensial database persisten setelah percobaan awal P1000. HR sehat; sweep manual dan tick cron otomatis pukul 03:15 UTC sama-sama menjawab `ok:true`, dan kini 22/22 job terakhir sukses.
- Lima order yang dibatalkan meliputi dua stalled, bukan tujuh order. Kelimanya melepas reservasi stok; dua pembayaran telah REFUNDED sebelum sweep; tidak ada delivery; CRM mencatat lima notifikasi pembatalan SENT. Tidak ada klaim pengiriman perangkat atau settlement eksternal.
- Gate `audit:ci` kini menolak laporan npm audit yang invalid. Fixture error/bersih/high belum diizinkan memberi exit 1/0/1; run nyata exit 0 dengan 0 critical, 1 high di-allowlist, 17 moderate. Bukti `audit-gate-current.log`.

## Lanjutan verifikasi dan ORD-01 2026-11-04

- Setup auth e2e memakai env tes sebelum ConfigModule divalidasi; tes fokus 5/5 lulus. HR dan depot perlu Jest serial pada host ini karena worker paralel kehabisan memori; HR 106 suite/1.640 tes dan depot 71 suite/1.189 tes lulus serial.
- ORD-01: adapter consume stok dan qualify referral kini melempar kegagalan agar outbox tetap PENDING; award poin dan posting pendapatan juga menolak hasil tak terverifikasi. Semua topik DEAD memicu alert. Referral membekukan order/nominal pada PENDING, mengirim reward dengan key idempoten per sisi, dan baru menandai QUALIFIED setelah keduanya berhasil. Tes fokus order 484/484, referral 51/51, dan full referral 125/125 lulus.
- `npm run lint`, `npm run typecheck`, `npm run build`, dan `npm run audit:ci` exit 0 pada diff ini; log `lint-after-outbox.log`, `typecheck-after-outbox.log`, `build-after-outbox.log`, `audit-gate-after-outbox.log`. Pemeriksaan baca saja 15:12 WIB menunjukkan scheduler utama healthy, 23/23 baris job terakhir sukses, 16 job berjalan dalam satu jam terakhir.
- Run `npm run test` pertama pada diff ORD-01 gagal karena memori di worker depot/order. Setelah tiga layanan berat diserialkan, run kedua menemukan satu tes race referral lama yang masih mengasumsikan urutan transisi lama; tes diperbaiki dan seluruh referral lulus. Run root final sedang berjalan di `full-test-final-green.log`. Berikutnya: integrasi Docker pada project/volume baru `hydromart-audit-20261104`, review diff, pembaruan laporan, lalu commit bila semua gate lulus.
- Run root berikutnya melewati seluruh backend, tetapi web mencatat dua tes merah: pencarian `400.000` ambigu pada P&L, dan timeout chunk lock screen saat parallel load. Keduanya diperbaiki pada test saja; tes fokus 116/116 lulus. Run root terakhir kini berjalan di `full-test-web-fixed-final.log`.
- Harness Docker final pada project/volume baru `hydromart-audit-20261104-final` exit 0: 20/20 sehat, alur inti lengkap, HRIS 30/0/0, approvals 158/0/0, payroll manual lulus. Project tes otomatis diturunkan dan project utama tetap hidup. Bukti `isolated-integration-outbox-final-retry.log`; ringkasan di `09-remediation-and-verification.md`.
- `npm run test` final exit 0 di `full-test-web-fixed-final.log`: 630 suite Jest + 328 file Vitest, 12.840 tes lulus. Pemeriksaan terakhir stack utama pukul 17:00 WIB: scheduler healthy, 23/23 job terakhir ok, heartbeat UTC 10:00:02.
