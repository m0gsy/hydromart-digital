// Video 1 — Staff Depot (role STAFF_DEPOT, the courier). Screens: /driver/* and /hr/me/*.
// Labels: apps/web/src/lib/dictionaries/id/{driver,courierFix,hrFix}.ts. Names, orders and amounts
// are sample data.
import React from 'react';
import { useCurrentFrame } from 'remotion';
import {
  ArrowLeft,
  Camera,
  CheckCircle,
  ClockCounterClockwise,
  ListChecks,
  MapPin,
  Minus,
  NavigationArrow,
  Plus,
  Storefront,
  User,
  Wallet,
} from '@phosphor-icons/react';
import { EnrollScreen, FaceCheck, HrHome, LoginScreen, VerifyScreen } from './shared';
import {
  Btn,
  C,
  Card,
  Chip,
  ease,
  Field,
  Label,
  PageHead,
  Row,
  rupiah,
  Screens,
  Scroll,
  Sheet,
  Spot,
  Tapped,
  Toast,
  typed,
} from './ui';

const NAME = 'Andi Pratama';
const DEPOT = 'Depot Dago';
const ORDER = 'HM-20261122-104512';
const COD = 40000;

/** Wrap `node` in a tap and/or a highlight when this mark names it. */
interface Mark {
  id: string;
  tapAt?: number;
  spot?: { at: number; until?: number; text: string; place?: 'above' | 'below'; align?: 'left' | 'center' | 'right' };
}
const marked = (marks: Mark[], id: string, node: React.ReactNode, style?: React.CSSProperties) => {
  const m = marks.find((x) => x.id === id);
  if (!m) return <div style={style}>{node}</div>;
  const tapped = m.tapAt !== undefined ? <Tapped at={m.tapAt}>{node}</Tapped> : node;
  return m.spot ? (
    <Spot {...m.spot} style={style}>
      {tapped}
    </Spot>
  ) : (
    <div style={style}>{tapped}</div>
  );
};

// ── /driver home ──────────────────────────────────────────────────────────────
const BottomNav: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: 64,
      background: C.surface,
      borderTop: `1px solid ${C.border}`,
      display: 'flex',
      justifyContent: 'space-around',
      alignItems: 'center',
    }}
  >
    {(
      [
        [ListChecks, 'Tugas', true],
        [ClockCounterClockwise, 'Riwayat', false],
        [Wallet, 'Dompet', false],
        [User, 'Profil', false],
      ] as const
    ).map(([I, label, on]) => (
      <div key={label} style={{ textAlign: 'center', color: on ? C.brand700 : C.text, fontSize: 11.5, fontWeight: 700 }}>
        <I size={22} weight={on ? 'fill' : 'regular'} style={{ display: 'block', margin: '0 auto 2px' }} />
        {label}
      </div>
    ))}
  </div>
);

const TaskCard: React.FC<{ order: string; addr: string }> = ({ order, addr }) => (
  <Card style={{ marginBottom: 12, padding: 16 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ fontSize: 15.5, fontWeight: 800 }}>{order}</div>
      <Chip>Ditugaskan</Chip>
    </div>
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13.5, marginTop: 10 }}>
      <MapPin size={16} /> {addr}
    </div>
    <Btn style={{ marginTop: 12 }}>Konfirmasi barang diambil</Btn>
  </Card>
);

export const DriverHome: React.FC<{ marks?: Mark[] }> = ({ marks = [] }) => (
  <div style={{ position: 'absolute', inset: 0 }}>
    <div style={{ padding: '18px 20px 0', display: 'flex', justifyContent: 'space-between' }}>
      <div>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.5 }}>Pengantaran saya</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13.5, fontWeight: 700, marginTop: 4 }}>
          <Storefront size={15} weight="fill" color={C.brand700} /> Bertugas di depot
        </div>
      </div>
      {marked(
        marks,
        'online',
        <div
          style={{
            background: C.successBg,
            color: C.success,
            borderRadius: 999,
            padding: '7px 14px',
            fontWeight: 800,
            fontSize: 14,
            display: 'flex',
            gap: 6,
            alignItems: 'center',
          }}
        >
          <Storefront size={15} weight="fill" /> Online
        </div>,
        { alignSelf: 'flex-start' },
      )}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, padding: '16px 20px' }}>
      {[
        ['2', 'Aktif'],
        ['3', 'Selesai'],
        ['100%', 'Tepat'],
      ].map(([n, l]) => (
        <Card key={l} style={{ padding: 12 }}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{n}</div>
          <Label color={C.text}>{l}</Label>
        </Card>
      ))}
    </div>
    <div style={{ padding: '0 20px' }}>
      {marked(marks, 'card', <TaskCard order={ORDER} addr="Jl. Ir. H. Juanda No. 12, Bandung" />)}
      <TaskCard order="HM-20261122-104588" addr="Jl. Dipatiukur No. 35, Bandung" />
    </div>
    <BottomNav />
  </div>
);

// ── delivery detail ───────────────────────────────────────────────────────────
type DStatus = 'Ditugaskan' | 'Diambil' | 'Diantar';

const RouteMap: React.FC<{ from: number }> = ({ from }) => {
  const drive = ease(useCurrentFrame(), from, 150);
  const pts = [
    [30, 120],
    [80, 100],
    [80, 40],
    [210, 40],
    [210, 70],
    [300, 70],
  ];
  const seg = drive * (pts.length - 1);
  const k = Math.min(Math.floor(seg), pts.length - 2);
  const f = seg - k;
  const x = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f;
  const y = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * f;
  return (
    <div style={{ height: 140, marginTop: 10, borderRadius: 18, overflow: 'hidden', position: 'relative', background: '#e8efe9' }}>
      <svg viewBox="0 0 350 140" width="100%" height="100%">
        <path d="M0 40 H350 M0 100 H350 M80 0 V140 M210 0 V140 M300 0 V140" stroke="#fff" strokeWidth={10} />
        <path
          d={`M${pts.map((p) => p.join(' ')).join(' L')}`}
          stroke={C.brand600}
          strokeWidth={5}
          fill="none"
          strokeLinecap="round"
        />
        <circle cx={300} cy={70} r={9} fill={C.danger} />
        <circle cx={x} cy={y} r={10} fill={C.brand600} stroke="white" strokeWidth={3} />
      </svg>
    </div>
  );
};

/** /driver/deliveries/detail, the buttons in the order the page draws them. */
const Detail: React.FC<{ status: DStatus; codDue?: boolean; mapFrom?: number; marks?: Mark[] }> = ({
  status,
  codDue = true,
  mapFrom = -200,
  marks = [],
}) => {
  const small = { fontSize: 13, padding: '10px 4px' };
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px 12px' }}>
        <ArrowLeft size={20} weight="bold" />
        <div style={{ fontSize: 16, fontWeight: 800, flex: 1 }}>{ORDER}</div>
        <Chip tone={status === 'Diantar' ? 'brand' : 'neutral'}>{status}</Chip>
      </div>
      <div style={{ padding: '0 20px' }}>
        <Card style={{ padding: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Ibu Ratna</div>
          <div style={{ display: 'flex', gap: 6, fontSize: 13.5, marginTop: 6 }}>
            <MapPin size={16} style={{ flexShrink: 0 }} /> Jl. Ir. H. Juanda No. 12, Bandung
          </div>
          <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4, marginLeft: 22 }}>
            Patokan: pagar hijau, sebelah warung
          </div>
        </Card>
        {status === 'Diantar' && <RouteMap from={mapFrom} />}
        <Card style={{ padding: 14, marginTop: 10 }}>
          <Row k="Air Galon 19L (Isi Ulang) × 2" v={rupiah(COD)} />
          <Row k="Bayar di tempat (COD)" v={<Chip tone="warning">{rupiah(COD)}</Chip>} />
        </Card>
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          {status === 'Ditugaskan' && marked(marks, 'pickup', <Btn>Konfirmasi barang diambil</Btn>)}
          {status === 'Diambil' &&
            marked(
              marks,
              'start',
              <Btn>
                <NavigationArrow size={18} weight="fill" /> Mulai antar
              </Btn>,
            )}
          {status === 'Diantar' && (
            <>
              {marked(marks, 'arrived', <Btn style={codDue ? { opacity: 0.45 } : undefined}>Sampai tujuan · ambil bukti</Btn>)}
              {codDue && (
                <>
                  {marked(
                    marks,
                    'cash',
                    <Btn variant="outline" style={{ borderColor: C.brand600 }}>
                      Terima uang {rupiah(COD)}
                    </Btn>,
                  )}
                  <div style={{ fontSize: 12, color: C.textMuted, textAlign: 'center' }}>
                    Terima uangnya dulu — Selesai aktif setelah pembayaran tercatat.
                  </div>
                </>
              )}
              {marked(marks, 'returns', <Btn variant="outline">Retur galon kosong</Btn>)}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {marked(marks, 'noShow', <Btn variant="outline" style={small}>Tidak di tempat</Btn>)}
                {marked(marks, 'reschedule', <Btn variant="outline" style={small}>Jadwal ulang</Btn>)}
                {marked(marks, 'failed', <Btn variant="danger" style={small}>Gagal</Btn>)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ── scenes ────────────────────────────────────────────────────────────────────
const Login: React.FC = () => (
  <Screens at={[0, 150]}>
    {[<LoginScreen key="l" typeFrom={25} tapAt={115} />, <VerifyScreen key="v" typeFrom={175} tapAt={230} hintAt={265} />]}
  </Screens>
);

const Enroll: React.FC = () => (
  <Screens at={[0, 60]}>
    {[
      <HrHome key="h" name={NAME} tap="enroll" tapAt={35} />,
      <EnrollScreen key="e" shots={[110, 150, 190]} consentAt={230} saveAt={270} />,
    ]}
  </Screens>
);

const CheckIn: React.FC = () => (
  <Screens at={[0, 60]}>
    {[
      <HrHome key="h" name={NAME} tap="absen" tapAt={35} />,
      <FaceCheck
        key="f"
        depot={DEPOT}
        mode="Check-in"
        shootAt={150}
        doneAt={195}
        result="Masuk 07.28"
        spot={{ at: 250, on: 'result', text: '📍 GPS menyala, mode lokasi Tepat, dan berada di area depot' }}
      />,
    ]}
  </Screens>
);

const Shift: React.FC = () => {
  const frame = useCurrentFrame();
  const items: [string, string][] = [
    ['Depot penempatan', `${DEPOT} · Lokasi terverifikasi`],
    ['Kendaraan', 'Motor'],
    ['Baterai HP 82%', 'Cukup untuk satu shift'],
  ];
  return (
    <Screens at={[0, 235]}>
      {[
        <div key="s">
          <div style={{ padding: '28px 22px 8px' }}>
            <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.5 }}>Selamat datang, {NAME}</div>
            <div style={{ fontSize: 14, color: C.textMuted, marginTop: 6, lineHeight: 1.4 }}>
              Check-in di depot untuk memulai shift dan menerima tugas.
            </div>
          </div>
          <div style={{ padding: '10px 20px', display: 'grid', gap: 10 }}>
            {items.map(([k, v], i) => {
              const p = ease(frame, 30 + i * 22, 10);
              return (
                <Card key={k} style={{ display: 'flex', gap: 12, alignItems: 'center', opacity: 0.3 + p * 0.7 }}>
                  <CheckCircle size={26} weight="fill" color={p > 0.5 ? C.success : C.border} />
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 800 }}>{k}</div>
                    <div style={{ fontSize: 13, color: C.textMuted, marginTop: 2 }}>{v}</div>
                  </div>
                </Card>
              );
            })}
            <div style={{ fontSize: 12.5, color: C.textMuted, textAlign: 'center', margin: '4px 0' }}>
              Kamu harus berada di area depot untuk memulai shift.
            </div>
            <Tapped at={200}>
              <Btn style={{ padding: 15 }}>Mulai shift · check-in</Btn>
            </Tapped>
          </div>
        </div>,
        <DriverHome key="d" />,
      ]}
    </Screens>
  );
};

const Pickup: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Screens at={[0, 140]}>
      {[
        <DriverHome
          key="d"
          marks={[
            { id: 'online', spot: { at: 25, until: 105, text: 'Pastikan status Online', align: 'right' } },
            { id: 'card', tapAt: 120 },
          ]}
        />,
        <Detail key="x" status={frame >= 212 ? 'Diambil' : 'Ditugaskan'} marks={[{ id: 'pickup', tapAt: 200 }]} />,
      ]}
    </Screens>
  );
};

const Deliver: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Detail
      status={frame >= 55 ? 'Diantar' : 'Diambil'}
      mapFrom={60}
      marks={[
        { id: 'start', tapAt: 45 },
        { id: 'arrived', spot: { at: 215, text: 'Pesanan COD: tombol ini aktif setelah uang diterima', place: 'above' } },
      ]}
    />
  );
};

const Stepper: React.FC<{ n: number; plusAt: number[] }> = ({ n, plusAt }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 18,
      border: `1px solid ${C.border}`,
      borderRadius: 999,
      padding: '6px 14px',
      background: C.surface,
    }}
  >
    <Minus size={18} color={C.textMuted} />
    <span style={{ fontSize: 18, fontWeight: 800, minWidth: 14, textAlign: 'center' }}>{n}</span>
    <Tapped at={plusAt}>
      <Plus size={18} />
    </Tapped>
  </div>
);

const Segment: React.FC<{ label: string; on: boolean }> = ({ label, on }) => (
  <div
    style={{
      textAlign: 'center',
      padding: '10px 0',
      borderRadius: 12,
      fontWeight: 700,
      border: `1.5px solid ${on ? C.brand600 : C.border}`,
      background: on ? C.brand50 : C.surface,
      color: on ? C.brand800 : C.text,
    }}
  >
    {label}
  </div>
);

const Returns: React.FC = () => {
  const frame = useCurrentFrame();
  const plus = [100, 125];
  return (
    <>
      <Detail status="Diantar" marks={[{ id: 'returns', tapAt: 38 }]} />
      <Sheet at={50} height={330}>
        <div style={{ fontSize: 19, fontWeight: 800 }}>Retur galon kosong</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '18px 0' }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Jumlah galon kembali</div>
          <Stepper n={plus.filter((t) => frame >= t + 3).length} plusAt={plus} />
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Kondisi galon</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Tapped at={160}>
            <Segment label="Baik" on={frame >= 163} />
          </Tapped>
          <Segment label="Rusak" on={false} />
        </div>
        <Tapped at={210} style={{ marginTop: 22 }}>
          <Btn style={{ padding: 14 }}>Catat retur</Btn>
        </Tapped>
      </Sheet>
      <Toast at={226}>Retur tercatat</Toast>
    </>
  );
};

const Cod: React.FC = () => {
  const frame = useCurrentFrame();
  const paid = frame >= 212;
  const amount = typed(frame, '50.000', 95, 4);
  return (
    <Screens at={[0, 50]}>
      {[
        <Detail key="d" status="Diantar" marks={[{ id: 'cash', tapAt: 35 }]} />,
        <div key="p">
          <PageHead title="Pembayaran tunai (COD)" sub={`${ORDER} · Ibu Ratna`} />
          <div style={{ padding: '0 20px' }}>
            <Card style={{ padding: 16, marginBottom: 14 }}>
              <Label>Total tagihan</Label>
              <div style={{ fontSize: 30, fontWeight: 800, marginTop: 4 }}>{rupiah(COD)}</div>
            </Card>
            {paid ? (
              <Card style={{ textAlign: 'center', padding: 20 }}>
                <div style={{ transform: `scale(${0.6 + ease(frame, 212, 10) * 0.4})` }}>
                  <CheckCircle size={60} weight="fill" color={C.success} />
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, marginTop: 6 }}>Pembayaran diterima</div>
                <Row k="Uang diterima" v={rupiah(50000)} />
                <Row k="Kembalian" v={rupiah(10000)} strong />
                <Tapped at={330} style={{ marginTop: 10 }}>
                  <Btn style={{ padding: 14 }}>Lanjut ke bukti serah terima</Btn>
                </Tapped>
              </Card>
            ) : (
              <>
                <Field
                  label="Uang diterima dari pelanggan"
                  prefix="Rp"
                  value={amount}
                  placeholder="0"
                  focus={frame < 195}
                  big
                />
                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  <Chip tone="brand">Uang pas</Chip>
                </div>
                <Card style={{ padding: 14, marginBottom: 14 }}>
                  <Row k="Kembalian" v={rupiah(amount === '50.000' ? 10000 : 0)} strong />
                </Card>
                <Tapped at={195}>
                  <Btn style={{ padding: 14 }}>Konfirmasi pembayaran</Btn>
                </Tapped>
              </>
            )}
          </div>
        </div>,
      ]}
    </Screens>
  );
};

const Radio: React.FC<{ label: string; on: boolean }> = ({ label, on }) => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', fontSize: 14, fontWeight: 600 }}>
    <div
      style={{
        width: 20,
        height: 20,
        borderRadius: '50%',
        border: `2px solid ${on ? C.brand600 : C.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {on && <div style={{ width: 10, height: 10, borderRadius: '50%', background: C.brand600 }} />}
    </div>
    {label}
  </div>
);

const DoorPhoto: React.FC = () => (
  <svg viewBox="0 0 350 150" width="100%" height="100%">
    <rect width="350" height="150" fill="#d8c7a8" />
    <rect x="200" y="10" width="110" height="140" fill="#7a5a3c" />
    <circle cx="290" cy="85" r="4" fill="#e3c27a" />
    {[60, 130].map((x) => (
      <g key={x}>
        <rect x={x} y={52} width={56} height={88} rx={14} fill="rgba(110,190,220,0.75)" />
        <rect x={x + 18} y={40} width={20} height={14} rx={3} fill="#1f6fa8" />
      </g>
    ))}
  </svg>
);

const Proof: React.FC = () => {
  const frame = useCurrentFrame();
  const photo = frame >= 48;
  const sign = ease(frame, 200, 45);
  return (
    <Screens at={[0, 295]}>
      {[
        <Scroll key="p" from={165} by={250} dur={25}>
          <PageHead title="Bukti pengantaran" sub={ORDER} />
          <div style={{ padding: '0 20px' }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>Foto pengantaran</div>
            <Tapped at={35}>
              <div
                style={{
                  height: 150,
                  borderRadius: 16,
                  border: photo ? 'none' : `2px dashed ${C.border}`,
                  background: C.surface,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                {photo ? (
                  <DoorPhoto />
                ) : (
                  <div style={{ textAlign: 'center', color: C.brand700, fontWeight: 700 }}>
                    <Camera size={30} />
                    <div>Ambil foto</div>
                  </div>
                )}
              </div>
            </Tapped>
            <div style={{ fontSize: 14, fontWeight: 800, margin: '16px 0 4px' }}>Kondisi segel galon</div>
            <Tapped at={100} style={{ width: 'fit-content' }}>
              <Radio label="Segel galon utuh & tidak bocor" on={frame >= 103} />
            </Tapped>
            <Radio label="Segel rusak" on={false} />
            <div style={{ marginTop: 12 }}>
              <Field
                label="Nama penerima"
                value={typed(frame, 'Ibu Ratna', 125, 3)}
                placeholder="Nama orang yang menerima"
                focus={frame >= 120 && frame < 165}
              />
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>Tanda tangan penerima (opsional)</div>
            <div style={{ height: 110, borderRadius: 16, background: C.surface, border: `1px solid ${C.border}` }}>
              <svg viewBox="0 0 350 110" width="100%" height="100%">
                <path
                  d="M40 70 C60 20, 80 100, 100 60 S140 30, 150 70 S190 90, 210 50 S260 40, 300 65"
                  stroke={C.text}
                  strokeWidth={3}
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={420}
                  strokeDashoffset={420 * (1 - sign)}
                />
              </svg>
            </div>
            <div style={{ marginTop: 12 }}>
              <Field label="Catatan (opsional)" value="" placeholder="Mis. dititipkan ke satpam" />
            </div>
            <Tapped at={268}>
              <Btn style={{ padding: 15 }}>Selesaikan pengantaran</Btn>
            </Tapped>
          </div>
        </Scroll>,
        <div key="d" style={{ padding: '40px 20px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ transform: `scale(${0.6 + ease(frame, 300, 10) * 0.4})` }}>
              <CheckCircle size={84} weight="fill" color={C.success} />
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, marginTop: 8 }}>Pengantaran selesai</div>
          </div>
          <Card style={{ marginTop: 20 }}>
            <Row k="Penerima" v="Ibu Ratna" />
            <Row k="Waktu" v="08.12" />
            <Row k="Lokasi GPS" v={<Chip tone="success">Tercatat</Chip>} />
            <Row k="Bukti" v="1 foto · tanda tangan" />
          </Card>
          <Tapped at={360} style={{ marginTop: 18 }}>
            <Btn style={{ padding: 14 }}>Tugas berikutnya</Btn>
          </Tapped>
          <Btn variant="ghost" style={{ marginTop: 6 }}>
            Kembali ke daftar
          </Btn>
        </div>,
      ]}
    </Screens>
  );
};

const Failed: React.FC = () => {
  const frame = useCurrentFrame();
  const reasons = ['Alamat tidak ditemukan', 'Pelanggan menolak', 'Barang rusak', 'Pelanggan tidak bisa dihubungi'];
  return (
    <>
      <Detail
        status="Diantar"
        codDue={false}
        marks={[
          { id: 'noShow', spot: { at: 15, until: 85, text: 'Catat usaha telepon / WhatsApp', place: 'above', align: 'left' } },
          { id: 'reschedule', spot: { at: 90, until: 160, text: 'Pilih Pagi, Siang, atau Sore', place: 'above' } },
          { id: 'failed', tapAt: 210, spot: { at: 165, until: 210, text: 'Pilih alasannya', place: 'above', align: 'right' } },
        ]}
      />
      <Sheet at={222} height={430}>
        <div style={{ fontSize: 19, fontWeight: 800 }}>Tandai pengantaran gagal</div>
        <div style={{ fontSize: 14, fontWeight: 700, margin: '14px 0 6px' }}>Alasan</div>
        {reasons.map((r, i) => {
          const row = (
            <div
              style={{
                padding: '11px 14px',
                borderRadius: 12,
                marginBottom: 8,
                fontSize: 14,
                fontWeight: 600,
                border: `1.5px solid ${i === 3 && frame >= 283 ? C.brand600 : C.border}`,
                background: i === 3 && frame >= 283 ? C.brand50 : C.surface,
              }}
            >
              {r}
            </div>
          );
          return i === 3 ? (
            <Tapped key={r} at={280}>
              {row}
            </Tapped>
          ) : (
            <div key={r}>{row}</div>
          );
        })}
        <Spot at={320} text="Simpan alasannya, jangan biarkan tugas menggantung" place="above" style={{ marginTop: 8 }}>
          <Btn variant="danger" style={{ padding: 14, background: C.danger, color: 'white' }}>
            Tandai gagal
          </Btn>
        </Spot>
      </Sheet>
    </>
  );
};

const Settle: React.FC = () => {
  const frame = useCurrentFrame();
  const recorded = frame >= 318;
  return (
    <Screens at={[0, 40, 140]}>
      {[
        <DriverHome key="d" marks={[{ id: 'online', tapAt: 25 }]} />,
        <div key="s">
          <PageHead title="Status ketersediaan" />
          <div style={{ padding: '0 20px', display: 'grid', gap: 10 }}>
            {(
              [
                ['Online', 'Menerima tugas baru otomatis', true],
                ['Istirahat', 'Jeda sementara · tugas aktif tetap jalan', false],
                ['Offline', 'Berhenti terima tugas baru', false],
              ] as const
            ).map(([k, v, on]) => (
              <Card key={k} style={{ border: `${on ? 2 : 1}px solid ${on ? C.brand600 : C.border}` }}>
                <div style={{ fontSize: 15, fontWeight: 800 }}>{k}</div>
                <div style={{ fontSize: 13, color: C.textMuted, marginTop: 2 }}>{v}</div>
              </Card>
            ))}
            <div style={{ fontSize: 12.5, color: C.textMuted, lineHeight: 1.4 }}>
              Saat istirahat/offline, pesanan baru dialihkan ke kurir lain oleh admin depot.
            </div>
            <Tapped at={115}>
              <Btn variant="danger" style={{ padding: 14 }}>
                Akhiri shift · check-out
              </Btn>
            </Tapped>
          </div>
        </div>,
        <div key="c">
          <PageHead title="Setoran tunai (COD)" sub="Shift selesai" />
          <div style={{ padding: '0 20px' }}>
            <Card style={{ padding: 16, marginBottom: 14 }}>
              <Label>Seharusnya disetor</Label>
              <div style={{ fontSize: 30, fontWeight: 800, marginTop: 4 }}>{rupiah(120000)}</div>
              <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 6, lineHeight: 1.4 }}>
                Hitung semua uang tunai COD yang kamu kumpulkan shift ini, lalu masukkan jumlah yang kamu setor ke kasir.
              </div>
            </Card>
            {recorded ? (
              <Card style={{ textAlign: 'center', padding: 20 }}>
                <CheckCircle size={56} weight="fill" color={C.success} />
                <div style={{ fontSize: 18, fontWeight: 800, marginTop: 6 }}>Setoran tercatat</div>
                <div style={{ marginTop: 10 }}>
                  <Chip tone="warning">Menunggu verifikasi kasir</Chip>
                </div>
                <Row k="Kamu setor" v={rupiah(120000)} />
              </Card>
            ) : (
              <>
                <Field
                  label="Jumlah disetor ke kasir"
                  prefix="Rp"
                  value={typed(frame, '120.000', 190, 4)}
                  placeholder="0"
                  focus={frame >= 180}
                  big
                />
                <div style={{ fontSize: 12.5, color: C.textMuted, marginBottom: 14 }}>
                  Kasir akan mencocokkan setoranmu dengan total tagihan COD.
                </div>
                <Tapped at={300}>
                  <Btn style={{ padding: 14 }}>Setor ke kasir</Btn>
                </Tapped>
              </>
            )}
          </div>
          <Toast at={318}>Setoran tercatat</Toast>
        </div>,
      ]}
    </Screens>
  );
};

const CheckOut: React.FC = () => (
  <FaceCheck
    depot={DEPOT}
    mode="Check-out"
    modeAt={45}
    shootAt={110}
    doneAt={155}
    result="Masuk 07.28 · Keluar 17.05"
    spot={{ at: 200, on: 'toggle', text: 'Akhiri shift ≠ absen pulang. Tetap Check-out di sini.' }}
  />
);

const PROFILE = [
  'Absen & slip gaji',
  'Performa mingguan',
  'Pendapatan',
  'Setoran tunai (COD)',
  'Klaim pengeluaran',
  'Pengumuman',
  'Lapor insiden',
  'Pengaturan',
  'Bantuan & FAQ',
];

const More: React.FC = () => (
  <Screens at={[0, 190]}>
    {[
      <HrHome
        key="h"
        name={NAME}
        spots={[
          { card: 'cuti', at: 15, until: 55, text: 'Ajukan cuti & lihat sisa kuota' },
          { card: 'kasbon', at: 60, until: 100, text: 'Ajukan kasbon' },
          { card: 'slip', at: 105, until: 145, text: 'Lihat & unduh slip gaji (PDF)' },
          { card: 'pengumuman', at: 150, until: 188, text: 'Kabar dari HR' },
        ]}
      />,
      <div key="p">
        <PageHead title="Profil" sub={`${NAME} · Aktif`} />
        <div style={{ padding: '0 20px' }}>
          <Card style={{ padding: '4px 16px' }}>
            {PROFILE.map((k, i) => {
              const row = (
                <div
                  style={{
                    padding: '12px 0',
                    fontSize: 14.5,
                    fontWeight: 600,
                    borderBottom: i < PROFILE.length - 1 ? `1px solid ${C.border}` : undefined,
                    background: C.surface,
                  }}
                >
                  {k}
                </div>
              );
              return k === 'Klaim pengeluaran' ? (
                <Spot key={k} at={220} text="Bensin, parkir, tol: kirim dengan foto struk">
                  {row}
                </Spot>
              ) : (
                <div key={k}>{row}</div>
              );
            })}
          </Card>
          <div style={{ color: C.danger, fontWeight: 700, textAlign: 'center', marginTop: 14 }}>Keluar</div>
        </div>
      </div>,
    ]}
  </Screens>
);

export const STAFF_SCREENS: Record<string, React.FC> = {
  login: Login,
  enroll: Enroll,
  checkin: CheckIn,
  shift: Shift,
  pickup: Pickup,
  deliver: Deliver,
  returns: Returns,
  cod: Cod,
  proof: Proof,
  failed: Failed,
  settle: Settle,
  checkout: CheckOut,
  more: More,
};

export const STAFF_TITLE = {
  kicker: 'Tutorial Hydromart Ops',
  bullets: ['Masuk & absen wajah', 'Mulai shift', 'Antar pesanan + bukti', 'Setor uang & absen pulang'],
  outroBullets: ['Absen masuk', 'Mulai shift · check-in', 'Antar + bukti serah terima', 'Setor ke kasir & absen pulang'],
};
