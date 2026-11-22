// Video 2 — Kepala Depot (role KEPALA_DEPOT). The operator console under /dashboard/* plus /hr/me.
// Labels: apps/web/src/lib/dictionaries/id/{hrFix,dashB,opsFix,opsFixWalkIn,ops,order}.ts and
// components/dashboard/cashier-shift-bar.tsx. Names, orders and amounts are sample data.
import React from 'react';
import { useCurrentFrame } from 'remotion';
import { Bell, CheckCircle, Lock, MapPin, Minus, Plus, Printer, WhatsappLogo } from '@phosphor-icons/react';
import { FaceCheck, HrHome, LoginScreen, VerifyScreen } from './shared';
import {
  Btn,
  C,
  Card,
  Chip,
  Drop,
  ease,
  Field,
  Label,
  Row,
  rupiah,
  Screens,
  Scroll,
  Sheet,
  Spot,
  Tapped,
  Toast,
  typed,
  useCount,
} from './ui';

const NAME = 'Dewi Lestari';
const DEPOT = 'Depot Dago';
const TODAY = 'Minggu, 22 Nov 2026';

// ── operator shell ────────────────────────────────────────────────────────────
const TABS = [
  'Ringkasan',
  'Antrean',
  'Penjualan',
  'Kurir',
  'Inventory',
  'Retur',
  'Setoran',
  'Persetujuan',
  'Pelanggan',
  'Loyalti',
  'Pemasaran',
  'Komisi kurir',
  'Keuangan',
  'Tim',
  'Pengaturan',
  'Absen saya',
] as const;
type Tab = (typeof TABS)[number];

// Rough pill widths, enough to scroll the bar so the active tab is in view.
const tabW = (t: string) => t.length * 8.4 + 28;
const tabX = (t: Tab) => TABS.slice(0, TABS.indexOf(t)).reduce((x, k) => x + tabW(k) + 4, 0);

/**
 * The top-tab console a KEPALA_DEPOT lands on (components/operator/operator-shell.tsx).
 * `tapTab` + `tapAt` put a finger on a tab; the bar scrolls to whichever tab is active.
 */
const Shell: React.FC<{ tab: Tab; tapTab?: Tab; tapAt?: number; scrollFrom?: number; children?: React.ReactNode }> = ({
  tab,
  tapTab,
  tapAt = -99,
  scrollFrom = -99,
  children,
}) => {
  const frame = useCurrentFrame();
  const focus = tapTab ?? tab;
  const target = Math.max(0, tabX(focus) - 140);
  const x = scrollFrom < 0 ? target : ease(frame, scrollFrom, 24) * target;
  const active = tapTab && frame >= tapAt + 4 ? tapTab : tab;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px 8px', background: C.surface }}>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            background: C.brand600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Drop size={24} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{DEPOT}</div>
          <div style={{ fontSize: 11.5, color: C.textMuted }}>{NAME} · Operator depot</div>
        </div>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            background: C.soft,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          <Bell size={20} />
          <div style={{ position: 'absolute', top: 7, right: 8, width: 8, height: 8, borderRadius: 4, background: C.danger }} />
        </div>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            background: C.brand800,
            color: 'white',
            fontWeight: 800,
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          DL
        </div>
      </div>
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, overflow: 'hidden', padding: '2px 0 8px' }}>
        <div style={{ display: 'flex', gap: 4, paddingLeft: 12, transform: `translateX(${-x}px)` }}>
          {TABS.map((t) => {
            const pill = (
              <div
                style={{
                  width: tabW(t),
                  textAlign: 'center',
                  padding: '7px 0',
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  background: active === t ? C.brand50 : 'transparent',
                  color: active === t ? C.brand800 : C.textMuted,
                }}
              >
                {t}
              </div>
            );
            return t === tapTab ? (
              <Tapped key={t} at={tapAt}>
                {pill}
              </Tapped>
            ) : (
              <div key={t}>{pill}</div>
            );
          })}
        </div>
      </div>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>{children}</div>
    </div>
  );
};

const H1: React.FC<{ children: React.ReactNode; right?: React.ReactNode; sub?: string }> = ({ children, right, sub }) => (
  <div style={{ padding: '16px 18px 10px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <div style={{ fontSize: 23, fontWeight: 800, letterSpacing: -0.5 }}>{children}</div>
      {right && <div style={{ fontSize: 12.5, color: C.textMuted }}>{right}</div>}
    </div>
    {sub && <div style={{ fontSize: 13.5, color: C.textMuted, marginTop: 4 }}>{sub}</div>}
  </div>
);

/** Hub screens (e.g. Inventory) carry their own row of tabs under the console tabs. */
const SubTabs: React.FC<{ tabs: string[]; active: string; tap?: string; tapAt?: number }> = ({ tabs, active, tap, tapAt = -99 }) => {
  const frame = useCurrentFrame();
  const on = tap && frame >= tapAt + 4 ? tap : active;
  return (
    <div style={{ display: 'flex', gap: 18, padding: '10px 18px 0', borderBottom: `1px solid ${C.border}` }}>
      {tabs.map((t) => {
        const el = (
          <div
            style={{
              padding: '6px 0 9px',
              fontSize: 14,
              fontWeight: 700,
              color: on === t ? C.brand700 : C.textMuted,
              borderBottom: `2.5px solid ${on === t ? C.brand600 : 'transparent'}`,
            }}
          >
            {t}
          </div>
        );
        return t === tap ? (
          <Tapped key={t} at={tapAt}>
            {el}
          </Tapped>
        ) : (
          <div key={t}>{el}</div>
        );
      })}
    </div>
  );
};

const Stepper: React.FC<{ n: number; plusAt?: number[] }> = ({ n, plusAt = [] }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      border: `1px solid ${C.border}`,
      borderRadius: 999,
      padding: '6px 12px',
      background: C.surface,
    }}
  >
    <Minus size={16} color={n ? C.text : C.border} />
    <span style={{ fontSize: 16, fontWeight: 800, minWidth: 12, textAlign: 'center' }}>{n}</span>
    <Tapped at={plusAt}>
      <Plus size={16} />
    </Tapped>
  </div>
);

const Choice: React.FC<{ label: string; on: boolean }> = ({ label, on }) => (
  <div
    style={{
      textAlign: 'center',
      padding: '10px 4px',
      borderRadius: 12,
      fontWeight: 700,
      fontSize: 14,
      border: `1.5px solid ${on ? C.brand600 : C.border}`,
      background: on ? C.brand50 : C.surface,
      color: on ? C.brand800 : C.text,
    }}
  >
    {label}
  </div>
);

// ── scenes ────────────────────────────────────────────────────────────────────
const Login: React.FC = () => (
  <Screens at={[0, 100, 190, 240, 280]}>
    {[
      <LoginScreen key="l" typeFrom={15} tapAt={75} />,
      <VerifyScreen key="v" typeFrom={110} tapAt={165} />,
      <Shell key="s" tab="Ringkasan" tapTab="Absen saya" tapAt={222} scrollFrom={195}>
        <H1 right={TODAY}>Ringkasan hari ini</H1>
      </Shell>,
      <HrHome key="h" name={NAME} tap="absen" tapAt={262} />,
      <FaceCheck key="f" depot={DEPOT} mode="Check-in" shootAt={300} doneAt={330} result="Masuk 07.31" />,
    ]}
  </Screens>
);

const Kpi: React.FC<{ label: string; value: React.ReactNode; tone?: string }> = ({ label, value, tone = C.text }) => (
  <Card style={{ padding: '12px 16px' }}>
    <Label color={tone === C.text ? C.textMuted : tone}>{label}</Label>
    <div style={{ fontSize: 26, fontWeight: 800, color: tone, marginTop: 2 }}>{value}</div>
  </Card>
);

const Ringkasan: React.FC = () => {
  const orders = useCount(18, 10);
  const assign = useCount(3, 16);
  const cod = useCount(360000, 22, 30);
  const spots = [
    { at: 45, until: 85, text: 'Semua pesanan hari ini' },
    { at: 88, until: 128, text: 'Belum ada kurirnya: tugaskan segera' },
    { at: 131, until: 171, text: 'Kurir yang sedang bertugas' },
    { at: 174, until: 214, text: 'Uang COD yang masih dipegang kurir' },
  ];
  return (
    <Shell tab="Ringkasan">
      <Scroll from={230} by={300} dur={30}>
        <H1 right={TODAY}>Ringkasan hari ini</H1>
        <div style={{ padding: '0 18px', display: 'grid', gap: 10 }}>
          <Spot {...spots[0]}>
            <Kpi label="Pesanan masuk" value={orders} />
          </Spot>
          <Spot {...spots[1]}>
            <Kpi label="Perlu ditugaskan" value={assign} tone={C.warning} />
          </Spot>
          <Spot {...spots[2]}>
            <Kpi
              label="Kurir aktif"
              value={
                <>
                  4<span style={{ fontSize: 16, color: C.textMuted }}>/6</span>
                </>
              }
            />
          </Spot>
          <Spot {...spots[3]} place="above">
            <Kpi label="COD belum disetor" value={rupiah(cod)} />
          </Spot>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>Perlu ditugaskan</div>
              <div style={{ color: C.brand800, fontWeight: 700, fontSize: 13.5 }}>Lihat antrean</div>
            </div>
            {['HM-20261122-104601 · Bu Sri', 'HM-20261122-104615 · Pak Hadi'].map((o) => (
              <div key={o} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{o}</span>
                <Btn style={{ padding: '7px 12px', fontSize: 13 }}>Tugaskan</Btn>
              </div>
            ))}
          </Card>
          <Card>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.danger }}>Stok menipis · 1</div>
            <Row k="Galon 19L + Air (Baru)" v="sisa 4" />
          </Card>
          <Card>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Setoran menunggu</div>
            <div style={{ fontSize: 13.5, color: C.textMuted, margin: '4px 0 10px' }}>2 kurir belum setor</div>
            <Btn variant="outline">Verifikasi setoran</Btn>
          </Card>
        </div>
      </Scroll>
    </Shell>
  );
};

const OrderCard: React.FC<{ status: string; tone?: 'neutral' | 'brand' | 'success'; action?: string; tapAt?: number }> = ({
  status,
  tone = 'neutral',
  action,
  tapAt = -99,
}) => (
  <Card style={{ marginBottom: 10 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 800 }}>HM-20261122-104601</div>
      <Chip tone={tone}>{status}</Chip>
    </div>
    <div style={{ fontSize: 13.5, marginTop: 6 }}>Bu Sri Wahyuni · Air Galon 19L (Isi Ulang) × 3</div>
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: C.textMuted, marginTop: 4 }}>
      <MapPin size={14} /> Jl. Tubagus Ismail No. 8
    </div>
    {action && (
      <Tapped at={tapAt} style={{ marginTop: 10 }}>
        <Btn>{action}</Btn>
      </Tapped>
    )}
  </Card>
);

const Queue: React.FC<{ children: React.ReactNode; tapTab?: boolean }> = ({ children, tapTab }) => (
  <Shell tab="Antrean">
    <H1>Antrean pesanan</H1>
    <div style={{ display: 'flex', gap: 8, padding: '0 18px 12px' }}>
      {['Perlu ditugaskan', 'Diproses', 'Dikirim', 'Ditutup'].map((c, i) => (
        <Chip key={c} tone={i === 0 && tapTab !== false ? 'brand' : 'neutral'}>
          {c}
        </Chip>
      ))}
    </div>
    <div style={{ padding: '0 18px' }}>
      {children}
      <Card style={{ opacity: 0.6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>HM-20261122-104615</div>
          <Chip>Dipesan</Chip>
        </div>
        <div style={{ fontSize: 13.5, marginTop: 6 }}>Pak Hadi · Galon 19L + Air (Baru) × 1</div>
      </Card>
    </div>
  </Shell>
);

const Process: React.FC = () => {
  const frame = useCurrentFrame();
  const status = frame >= 233 ? 'Disiapkan' : frame >= 148 ? 'Dikonfirmasi' : 'Dipesan';
  const next = status === 'Dipesan' ? 'Dikonfirmasi' : 'Disiapkan';
  return (
    <>
      <Queue>
        <OrderCard status="Dipesan" action="Proses" tapAt={50} />
      </Queue>
      <Sheet at={62} height={420}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>HM-20261122-104601</div>
          <Chip tone={status === 'Disiapkan' ? 'success' : 'brand'}>{status}</Chip>
        </div>
        <div style={{ fontSize: 14, marginTop: 8 }}>Bu Sri Wahyuni · 0812 2233 4455</div>
        <div style={{ fontSize: 13, color: C.textMuted, marginTop: 2 }}>Jl. Tubagus Ismail No. 8 · Patokan: rumah cat biru</div>
        <Card style={{ marginTop: 12, padding: '4px 14px' }}>
          <Row k="Air Galon 19L (Isi Ulang) × 3" v={rupiah(60000)} />
          <Row k="Total" v={rupiah(60000)} strong />
        </Card>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 10, marginTop: 16 }}>
          <Btn variant="outline">
            <Printer size={16} /> Cetak struk
          </Btn>
          {status !== 'Disiapkan' ? (
            <Tapped at={status === 'Dipesan' ? 140 : 225}>
              <Btn>Lanjut ke {next}</Btn>
            </Tapped>
          ) : (
            <Spot at={250} text="Siap diantar: tugaskan kurir" place="above" align="right">
              <Btn>Tugaskan</Btn>
            </Spot>
          )}
        </div>
      </Sheet>
    </>
  );
};

const COURIERS = [
  { name: 'Andi Pratama', line: 'Tersedia · 1 tugas aktif', tone: C.success, can: true },
  { name: 'Budi Santoso', line: 'Sibuk · 3 tugas aktif', tone: C.warning, can: false },
  { name: 'Citra Ayu', line: 'Belum buka shift', tone: C.textMuted, can: false },
];

const Assign: React.FC = () => {
  const frame = useCurrentFrame();
  const done = frame >= 215;
  return (
    <>
      <Queue tapTab={!done}>
        {done ? (
          <Spot at={235} text="Tugas langsung masuk ke HP kurir">
            <OrderCard status="Kurir ditugaskan" tone="success" />
          </Spot>
        ) : (
          <OrderCard status="Disiapkan" action="Tugaskan" tapAt={35} />
        )}
      </Queue>
      {!done && (
        <Sheet at={48} height={430}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Kurir tersedia</div>
          <div style={{ fontSize: 13, color: C.textMuted, marginTop: 2 }}>HM-20261122-104601 · Bu Sri Wahyuni</div>
          <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
            {COURIERS.map((c) => {
              const card = (
                <Card style={{ padding: 12, opacity: c.can ? 1 : 0.7 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        background: C.brand100,
                        color: C.brand800,
                        fontWeight: 800,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {c.name
                        .split(' ')
                        .map((w) => w[0])
                        .join('')}
                    </div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 800 }}>{c.name}</div>
                      <div style={{ fontSize: 13, color: c.tone, fontWeight: 600 }}>{c.line}</div>
                    </div>
                  </div>
                  {c.can && (
                    <Tapped at={195} style={{ marginTop: 10 }}>
                      <Btn>Tugaskan ke {c.name}</Btn>
                    </Tapped>
                  )}
                </Card>
              );
              return c.can ? (
                <Spot key={c.name} at={75} until={185} text="Pilih yang Tersedia, tugasnya paling sedikit" place="below">
                  {card}
                </Spot>
              ) : (
                <div key={c.name}>{card}</div>
              );
            })}
          </div>
        </Sheet>
      )}
    </>
  );
};

const Tracking: React.FC = () => {
  const frame = useCurrentFrame();
  const a = ease(frame, 0, 240);
  const b = ease(frame, 20, 240);
  return (
    <Shell tab="Kurir">
      <H1>Live tracking</H1>
      <div style={{ padding: '0 18px' }}>
        <div style={{ height: 230, borderRadius: 18, overflow: 'hidden', background: '#e8efe9', position: 'relative' }}>
          <svg viewBox="0 0 354 230" width="100%" height="100%">
            <path d="M0 60 H354 M0 150 H354 M70 0 V230 M180 0 V230 M290 0 V230 M0 210 L354 20" stroke="#fff" strokeWidth={10} />
            <rect x={160} y={130} width={40} height={40} rx={10} fill={C.brand800} />
            <circle cx={70 + a * 220} cy={60} r={10} fill={C.brand600} stroke="white" strokeWidth={3} />
            <circle cx={180} cy={150 - b * 140} r={10} fill={C.amber} stroke="white" strokeWidth={3} />
            <circle cx={290} cy={60} r={8} fill={C.danger} />
            <circle cx={180} cy={10} r={8} fill={C.danger} />
          </svg>
          <div style={{ position: 'absolute', left: 168, top: 138, width: 24, height: 24 }}>
            <Drop size={24} />
          </div>
        </div>
        {[
          ['Andi Pratama', 'HM-20261122-104512', C.brand600],
          ['Budi Santoso', 'HM-20261122-104588', C.amber],
        ].map(([n, o, col], i) => (
          <Card key={n} style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 12, height: 12, borderRadius: 6, background: col }} />
              <div style={{ fontSize: 15, fontWeight: 800, flex: 1 }}>{n}</div>
              <Chip tone="brand">Dalam perjalanan</Chip>
            </div>
            <div style={{ fontSize: 13, color: C.textMuted, margin: '4px 0 10px 20px' }}>{o}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 8 }}>
              <Btn variant="outline" style={{ fontSize: 13, padding: '8px 4px' }}>
                Detail
              </Btn>
              {i === 1 ? (
                <Spot at={140} text="Kurir berhalangan? Tarik kembali ke antrean" place="above" align="right">
                  <Btn variant="outline" style={{ fontSize: 13, padding: '8px 4px' }}>
                    Tarik ke antrean
                  </Btn>
                </Spot>
              ) : (
                <Btn variant="outline" style={{ fontSize: 13, padding: '8px 4px' }}>
                  Tarik ke antrean
                </Btn>
              )}
            </div>
          </Card>
        ))}
      </div>
    </Shell>
  );
};

const ShiftOpenCard: React.FC<{ closeTapAt?: number }> = ({ closeTapAt = -99 }) => (
  <Card style={{ padding: 14 }}>
    <div style={{ fontSize: 15, fontWeight: 800 }}>Shift terbuka — {NAME}</div>
    <div style={{ fontSize: 13, color: C.textMuted, marginTop: 2 }}>Modal awal {rupiah(200000)} · sejak 07.45</div>
    <Tapped at={closeTapAt} style={{ marginTop: 8, width: 'fit-content' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: C.brand700, fontWeight: 700, fontSize: 14, padding: '6px 8px' }}>
        <Lock size={18} /> Tutup shift
      </div>
    </Tapped>
  </Card>
);

const PRODUCTS = [
  { name: 'Air Galon 19L (Isi Ulang)', sku: 'AIR-GALON-19L', price: 20000, left: 999 },
  { name: 'Galon 19L + Air (Baru)', sku: 'GALON-BARU-19L', price: 65000, left: 4 },
  { name: 'Air Botol 600ml (Dus isi 24)', sku: 'AIR-BTL-600', price: 48000, left: 18 },
  { name: 'Air Gelas 240ml (Dus isi 48)', sku: 'AIR-CUP-240', price: 22000, left: 25 },
];

const ProductList: React.FC<{ qty?: number[]; plusAt?: number[][] }> = ({ qty = [0, 0, 0, 0], plusAt = [] }) => (
  <Card style={{ padding: '2px 14px' }}>
    {PRODUCTS.map((p, i) => (
      <div
        key={p.sku}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 0',
          borderBottom: i < PRODUCTS.length - 1 ? `1px solid ${C.border}` : undefined,
        }}
      >
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 700 }}>{p.name}</div>
          <div style={{ fontSize: 12, color: C.textMuted }}>
            {p.sku} · {rupiah(p.price)}
            {p.left < 999 ? ` · sisa ${p.left}` : ''}
          </div>
        </div>
        <Stepper n={qty[i]} plusAt={plusAt[i]} />
      </div>
    ))}
  </Card>
);

const Walkin: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Shell tab="Penjualan">
    <H1 sub="Pembeli datang langsung, bayar tunai.">Penjualan di depot</H1>
    <div style={{ padding: '0 18px', display: 'grid', gap: 12 }}>{children}</div>
  </Shell>
);

const OpenShift: React.FC = () => {
  const frame = useCurrentFrame();
  const open = frame >= 160;
  return (
    <>
      <Walkin>
        {open ? (
          <ShiftOpenCard />
        ) : (
          <Card style={{ padding: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Belum ada shift terbuka</div>
            <Field
              label="Uang kembalian awal di laci"
              prefix="Rp"
              value={typed(frame, '200.000', 60, 4)}
              placeholder="0"
              focus={frame >= 50 && frame < 150}
            />
            <Tapped at={150}>
              <Btn>Buka shift</Btn>
            </Tapped>
          </Card>
        )}
        <div style={{ opacity: open ? 1 : 0.35 }}>
          <ProductList />
        </div>
      </Walkin>
      <Toast at={160}>Shift dibuka.</Toast>
    </>
  );
};

const Sale: React.FC = () => {
  const frame = useCurrentFrame();
  const plus = [[40, 60], [85], [], []];
  const qty = plus.map((ts) => ts.filter((t) => frame >= t + 3).length);
  const total = qty.reduce((s, q, i) => s + q * PRODUCTS[i].price, 0);
  const items = qty.reduce((a, b) => a + b, 0);
  const cash = typed(frame, '110.000', 230, 4);
  const method = frame >= 203 ? 'Tunai' : '';
  return (
    <Screens at={[0, 145, 370]}>
      {[
        <div key="a" style={{ position: 'absolute', inset: 0 }}>
          <Walkin>
            <ShiftOpenCard />
            <ProductList qty={qty} plusAt={plus} />
          </Walkin>
          <div
            style={{
              position: 'absolute',
              left: 12,
              right: 12,
              bottom: 14,
              background: C.brand800,
              color: 'white',
              borderRadius: 18,
              padding: '10px 10px 10px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              transform: `translateY(${(1 - ease(frame, 43, 10)) * 120}px)`,
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, opacity: 0.8 }}>Keranjang · {items} item</div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{rupiah(total)}</div>
            </div>
            <Tapped at={130}>
              <Btn style={{ background: 'white', color: C.brand800, padding: '10px 22px' }}>Lanjut</Btn>
            </Tapped>
          </div>
        </div>,
        <Shell key="b" tab="Penjualan">
          <div style={{ padding: '14px 18px', display: 'grid', gap: 12 }}>
            <Card style={{ padding: '4px 14px' }}>
              <Row k="Air Galon 19L (Isi Ulang) × 2" v={rupiah(40000)} />
              <Row k="Galon 19L + Air (Baru) × 1" v={rupiah(65000)} />
              <Row k="Total" v={rupiah(105000)} strong />
            </Card>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>Pelanggan</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Choice label="Pembeli umum" on />
                <Choice label="Cek pelanggan" on={false} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>Metode pembayaran</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <Tapped at={200}>
                  <Choice label="Tunai" on={method === 'Tunai'} />
                </Tapped>
                <Choice label="QRIS" on={false} />
                <Choice label="TRANSFER" on={false} />
              </div>
            </div>
            <div>
              <Field label="Uang tunai diterima" prefix="Rp" value={cash} placeholder="0" focus={frame >= 225 && frame < 320} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Chip tone="brand">Uang pas</Chip>
                <div style={{ fontSize: 15, fontWeight: 800 }}>
                  Kembalian {rupiah(cash === '110.000' ? 5000 : 0)}
                </div>
              </div>
            </div>
            <Tapped at={330}>
              <Btn style={{ padding: 14 }}>
                <Printer size={18} /> Simpan &amp; cetak struk
              </Btn>
            </Tapped>
          </div>
          <Toast at={345}>Penjualan HM-20261122-104733 tersimpan.</Toast>
        </Shell>,
        <Walkin key="c">
          <ShiftOpenCard />
          <Card>
            <Label>Penjualan terakhir</Label>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>HM-20261122-104733</div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{rupiah(105000)}</div>
            </div>
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
              <Btn variant="outline">
                <Printer size={16} /> Cetak ulang struk
              </Btn>
              <Spot at={400} text="Struk juga bisa dikirim ke WhatsApp pembeli" place="below">
                <Btn variant="outline">
                  <WhatsappLogo size={16} /> Kirim struk via WhatsApp
                </Btn>
              </Spot>
              <Btn variant="ghost" style={{ color: C.danger }}>
                Batalkan penjualan
              </Btn>
            </div>
          </Card>
        </Walkin>,
      ]}
    </Screens>
  );
};

const CloseShift: React.FC = () => {
  const frame = useCurrentFrame();
  const closed = frame >= 195;
  return (
    <>
      <Walkin>
        <ShiftOpenCard closeTapAt={40} />
        <ProductList />
      </Walkin>
      <Sheet at={52} height={closed ? 360 : 340}>
        <div style={{ fontSize: 19, fontWeight: 800 }}>{closed ? 'Shift ditutup' : 'Tutup shift'}</div>
        {closed ? (
          <>
            <Card style={{ marginTop: 14, padding: '4px 14px' }}>
              <Row k="Seharusnya" v={rupiah(305000)} />
              <Row k="Dihitung" v={rupiah(305000)} />
              <Spot at={235} text="Selisih Rp 0: uang di laci cocok" place="above">
                <div style={{ background: C.surface }}>
                  <Row k="Selisih" v={<Chip tone="success">{rupiah(0)}</Chip>} strong />
                </div>
              </Spot>
            </Card>
            <CheckCircle size={44} weight="fill" color={C.success} style={{ display: 'block', margin: '16px auto 0' }} />
          </>
        ) : (
          <div style={{ marginTop: 14 }}>
            <Field
              label="Uang tunai dihitung di laci"
              prefix="Rp"
              value={typed(frame, '305.000', 90, 4)}
              placeholder="0"
              focus={frame >= 80 && frame < 180}
              big
            />
            <div style={{ fontSize: 12.5, color: C.textMuted, marginBottom: 14 }}>Hitung dulu, baru masukkan. Selisih dihitung server.</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
              <Btn variant="outline">Batal</Btn>
              <Tapped at={180}>
                <Btn>Tutup &amp; hitung selisih</Btn>
              </Tapped>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
};

const STOCK = [
  { name: 'Galon 19L + Air (Baru)', qty: 4, min: 10 },
  { name: 'Air Botol 600ml (Dus isi 24)', qty: 18, min: 6 },
  { name: 'Air Gelas 240ml (Dus isi 48)', qty: 25, min: 6 },
  { name: 'Tutup galon (segel)', qty: 340, min: 100 },
];

const InventoryHub: React.FC<{ sub: string; tap?: string; tapAt?: number; children: React.ReactNode }> = ({
  sub,
  tap,
  tapAt,
  children,
}) => (
  <Shell tab="Inventory">
    <SubTabs tabs={['Inventori', 'Retur galon', 'Meteran air']} active={sub} tap={tap} tapAt={tapAt} />
    {children}
  </Shell>
);

const Inventory: React.FC = () => {
  const frame = useCurrentFrame();
  const received = frame >= 230;
  return (
    <>
      <InventoryHub sub="Inventori">
        <div style={{ padding: '12px 18px', display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {['Stok', 'Pergerakan', 'Transfer'].map((v, i) => (
              <Chip key={v} tone={i === 0 ? 'brand' : 'neutral'}>
                {v}
              </Chip>
            ))}
          </div>
          {STOCK.map((s, i) => {
            const qty = i === 0 && received ? s.qty + 24 : s.qty;
            const low = qty < s.min;
            const card = (
              <Card style={{ padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 14.5, fontWeight: 800 }}>{s.name}</div>
                  {low && <Chip tone="danger">Stok menipis</Chip>}
                </div>
                <div style={{ fontSize: 13, color: C.textMuted, margin: '4px 0 8px' }}>
                  Stok <b style={{ color: C.text, fontSize: 15 }}>{qty}</b> · Min {s.min}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {i === 0 ? (
                    <Tapped at={60}>
                      <Btn variant="outline" style={{ padding: '8px 4px', fontSize: 13.5 }}>
                        Terima
                      </Btn>
                    </Tapped>
                  ) : (
                    <Btn variant="outline" style={{ padding: '8px 4px', fontSize: 13.5 }}>
                      Terima
                    </Btn>
                  )}
                  <Btn variant="outline" style={{ padding: '8px 4px', fontSize: 13.5 }}>
                    Sesuaikan
                  </Btn>
                </div>
              </Card>
            );
            return i === 1 ? (
              <Spot key={s.name} at={260} text="Sesuaikan: koreksi jumlah, mis. -2 bila ada yang rusak" place="below">
                {card}
              </Spot>
            ) : (
              <div key={s.name}>{card}</div>
            );
          })}
        </div>
      </InventoryHub>
      {!received && (
        <Sheet at={72} height={330}>
          <div style={{ fontSize: 19, fontWeight: 800 }}>Terima stok</div>
          <div style={{ fontSize: 13.5, color: C.textMuted, margin: '4px 0 14px' }}>Galon 19L + Air (Baru) · stok 4</div>
          <Field label="Terima galon (mis. 10)" value={typed(frame, '24', 110, 6)} placeholder="mis. 10" focus={frame >= 100} big />
          <Field label="Alasan (opsional)" value={typed(frame, 'Kiriman pabrik', 135, 2)} placeholder="Alasan (opsional)" />
          <Tapped at={210}>
            <Btn style={{ padding: 14 }}>Terima stok</Btn>
          </Tapped>
        </Sheet>
      )}
    </>
  );
};

const Meter: React.FC = () => {
  const frame = useCurrentFrame();
  const on = frame >= 34;
  return (
    <>
      <InventoryHub sub="Inventori" tap="Meteran air" tapAt={30}>
        {on ? (
          <div style={{ padding: '14px 18px' }}>
            <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 4 }}>Catat meteran</div>
            <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 14 }}>{TODAY}</div>
            <Field label="Meteran pagi (m³)" value={typed(frame, '1284,5', 70, 5)} placeholder="0" focus={frame >= 60 && frame < 190} big />
            <Spot at={232} text="Sore saat tutup: isi form yang sama" place="below">
              <Field label="Meteran sore (m³)" value="" placeholder="diisi saat tutup" big />
            </Spot>
            <Spot at={120} until={185} text="Pagi saat buka, sore saat tutup" place="above">
              <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.4, marginBottom: 14, background: C.muted }}>
                Isi angka pagi saat buka, angka sore saat tutup. Form yang sama dipakai dua kali.
              </div>
            </Spot>
            <Tapped at={200}>
              <Btn style={{ padding: 14 }}>Simpan</Btn>
            </Tapped>
          </div>
        ) : (
          <div style={{ padding: 18, opacity: 0.4 }}>
            <ProductList />
          </div>
        )}
      </InventoryHub>
    </>
  );
};

const Settle: React.FC = () => {
  const frame = useCurrentFrame();
  const verified = frame >= 245;
  const row = (name: string, amount: number, n: number, time: string, tapAt?: number) => (
    <Card key={name}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>{name}</div>
        <div style={{ fontSize: 15, fontWeight: 800 }}>Disetor {rupiah(amount)}</div>
      </div>
      <div style={{ fontSize: 13, color: C.textMuted, margin: '4px 0 10px' }}>
        {n} pesanan COD · setor {time}
      </div>
      {tapAt !== undefined ? (
        <Tapped at={tapAt}>
          <Btn>Hitung &amp; verifikasi</Btn>
        </Tapped>
      ) : (
        <Btn>Hitung &amp; verifikasi</Btn>
      )}
    </Card>
  );
  return (
    <>
      <Shell tab="Setoran">
        <H1 sub={`Shift 22 Nov · ${verified ? 1 : 2} setoran menunggu`}>Verifikasi setoran COD</H1>
        <div style={{ padding: '0 18px', display: 'grid', gap: 10 }}>
          {!verified && row('Andi Pratama', 120000, 3, '17.10', 60)}
          {row('Budi Santoso', 180000, 4, '17.22')}
        </div>
      </Shell>
      {!verified && (
        <Sheet at={72} height={420}>
          <div style={{ fontSize: 19, fontWeight: 800 }}>Andi Pratama</div>
          <div style={{ fontSize: 13, color: C.textMuted, marginTop: 2 }}>3 pesanan COD · setor 17.10</div>
          <Card style={{ marginTop: 14, padding: '4px 14px' }}>
            <Row k="Wajib setor" v={rupiah(120000)} />
            <Spot at={130} until={215} text="Hitung uang fisiknya, cocokkan dengan Wajib setor" place="below">
              <div style={{ background: C.surface }}>
                <Row
                  k="Disetor"
                  v={
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {rupiah(120000)} <Chip tone="success">pas</Chip>
                    </span>
                  }
                />
              </div>
            </Spot>
          </Card>
          <div style={{ marginTop: 12 }}>
            <Field label="Catatan (opsional)" value="" placeholder="mis. dihitung bersama kasir" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Btn variant="danger">Sengketakan</Btn>
            <Tapped at={230}>
              <Btn>Verifikasi</Btn>
            </Tapped>
          </div>
        </Sheet>
      )}
    </>
  );
};

const CloseBook: React.FC = () => {
  const frame = useCurrentFrame();
  const closed = frame >= 215;
  return (
    <Shell tab="Keuangan" scrollFrom={0}>
      <SubTabs tabs={['Laporan']} active="Laporan" />
      <H1 right={TODAY}>Laporan</H1>
      <div style={{ padding: '0 18px', display: 'grid', gap: 10 }}>
        <Card style={{ padding: '4px 14px' }}>
          <Row k="Galon" v="54" />
          <Row k="Penjualan konter" v={rupiah(105000)} />
          <Row k="Total" v={rupiah(1245000)} strong />
        </Card>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
          <Btn variant="outline" style={{ fontSize: 13 }}>
            Ekspor Excel
          </Btn>
          <Btn variant="outline" style={{ fontSize: 13 }}>
            CSV
          </Btn>
          <Btn variant="outline" style={{ fontSize: 13 }}>
            PDF
          </Btn>
        </div>
        {closed ? (
          <Card style={{ textAlign: 'center', padding: 18 }}>
            <div style={{ transform: `scale(${0.6 + ease(frame, 215, 10) * 0.4})` }}>
              <Lock size={44} weight="fill" color={C.success} />
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 6 }}>Buku ditutup</div>
            <div style={{ color: C.brand700, fontWeight: 700, fontSize: 13.5, marginTop: 8 }}>Buka kembali</div>
          </Card>
        ) : (
          <Spot at={60} until={190} text="Semua shift kasir harus sudah ditutup dulu" place="below">
            <Tapped at={200}>
              <Btn style={{ padding: 14 }}>
                <Lock size={16} weight="bold" /> Tutup buku
              </Btn>
            </Tapped>
          </Spot>
        )}
      </div>
    </Shell>
  );
};

export const KEPALA_SCREENS: Record<string, React.FC> = {
  login: Login,
  ringkasan: Ringkasan,
  process: Process,
  assign: Assign,
  tracking: Tracking,
  openshift: OpenShift,
  sale: Sale,
  closeshift: CloseShift,
  inventory: Inventory,
  meter: Meter,
  settle: Settle,
  closebook: CloseBook,
};

export const KEPALA_TITLE = {
  kicker: 'Tutorial Hydromart Ops',
  bullets: ['Absen & cek Ringkasan', 'Proses & tugaskan pesanan', 'Kasir: jual di depot', 'Stok, setoran & tutup buku'],
  outroBullets: [
    'Pagi: absen, meteran, buka shift',
    'Siang: tugaskan pesanan & jual',
    'Sore: tutup shift & verifikasi setoran',
    'Tutup buku harian',
  ],
};
