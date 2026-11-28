// Video 3 — Pelanggan (role CUSTOMER), the "Hydromart" app (id.hydromart.app).
// Labels: apps/web/src/lib/dictionaries/id/{auth,onboarding,home,shop,order,customerFix,subscriptions,
// review,profile,help,hrFix}.ts and id.ts; push texts: services/crm-service/src/domain/
// notification-event.ts. Look: docs/play-assets/screenshot-app-*.png. Names, prices, codes and point
// numbers are sample data.
import React from 'react';
import { useCurrentFrame } from 'remotion';
import {
  ArrowLeft,
  Bell,
  CaretRight,
  ChatCircleText,
  Check,
  CheckCircle,
  Copy,
  Crosshair,
  Drop as DropIcon,
  Heart,
  House,
  MagnifyingGlass,
  MapPin,
  Medal,
  Minus,
  Phone,
  Plus,
  Receipt,
  ShareNetwork,
  ShoppingCart,
  SquaresFour,
  Star,
  Truck,
  User,
  WhatsappLogo,
} from '@phosphor-icons/react';
import { LoginScreen, VerifyScreen } from './shared';
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
} from './ui';

const NAME = 'Budi';
const FULL = 'Budi Santoso';
const DEPOT = 'Depot Dago';
const ORDER = 'HM-20261122-104890';
const ADDRESS = 'Jl. Cigadung Raya No. 21, RT 02/RW 05';
const INK = '#16282e';

// ── chrome ────────────────────────────────────────────────────────────────────
const Circle: React.FC<{ dark?: boolean; children: React.ReactNode; badge?: number }> = ({ dark, children, badge }) => (
  <div
    style={{
      width: 40,
      height: 40,
      borderRadius: 20,
      background: dark ? INK : C.brand50,
      color: dark ? 'white' : C.brand800,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
    }}
  >
    {children}
    {badge ? (
      <div
        style={{
          position: 'absolute',
          top: -3,
          right: -3,
          minWidth: 18,
          height: 18,
          borderRadius: 9,
          background: C.brand600,
          color: 'white',
          fontSize: 11,
          fontWeight: 800,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px solid white',
        }}
      >
        {badge}
      </div>
    ) : null}
  </div>
);

type HeaderMark = { at: number; until?: number; text: string; align?: 'left' | 'center' | 'right' };

/** The customer app bar: wordmark (Beranda), search (Belanja) or back + title (other pages). */
const AppBar: React.FC<{
  kind: 'home' | 'search' | 'back';
  title?: string;
  cart?: number;
  cartTapAt?: number;
  bellSpot?: HeaderMark;
  cartSpot?: HeaderMark;
}> = ({ kind, title, cart = 0, cartTapAt, bellSpot, cartSpot }) => {
  const bell = (
    <Circle>
      <Bell size={19} weight="fill" />
    </Circle>
  );
  let cartEl: React.ReactNode = (
    <Circle dark badge={cart}>
      <ShoppingCart size={19} weight="bold" />
    </Circle>
  );
  if (cartTapAt !== undefined) cartEl = <Tapped at={cartTapAt}>{cartEl}</Tapped>;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 16px',
        background: C.surface,
        borderBottom: `1px solid ${C.border}`,
        height: 60,
        boxSizing: 'border-box',
      }}
    >
      {kind === 'home' && (
        <>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              background: C.brand600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Drop size={22} />
          </div>
          <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: -0.6, flex: 1 }}>hydromart</div>
        </>
      )}
      {kind === 'search' && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            border: `1px solid ${C.border}`,
            borderRadius: 999,
            padding: '9px 14px',
            color: C.textMuted,
            fontSize: 14,
          }}
        >
          <MagnifyingGlass size={17} color={C.brand600} /> Cari produk…
        </div>
      )}
      {kind === 'back' && (
        <>
          <ArrowLeft size={22} />
          <div style={{ fontSize: 18, fontWeight: 800, flex: 1, letterSpacing: -0.3 }}>{title}</div>
        </>
      )}
      {bellSpot ? (
        <Spot {...bellSpot} align={bellSpot.align ?? 'right'}>
          {bell}
        </Spot>
      ) : (
        bell
      )}
      {cartSpot ? (
        <Spot {...cartSpot} align={cartSpot.align ?? 'right'}>
          {cartEl}
        </Spot>
      ) : (
        cartEl
      )}
    </div>
  );
};

type Tab = 'Beranda' | 'Belanja' | 'Pesanan' | 'Akun';
const NAV: [Tab, typeof House][] = [
  ['Beranda', House],
  ['Belanja', SquaresFour],
  ['Pesanan', Receipt],
  ['Akun', User],
];

const BottomNav: React.FC<{
  active: Tab;
  tap?: Tab;
  tapAt?: number;
  spots?: { tab: Tab; at: number; until: number; text: string }[];
}> = ({ active, tap, tapAt = -99, spots = [] }) => {
  const frame = useCurrentFrame();
  const on = tap && frame >= tapAt + 4 ? tap : active;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: 66,
        background: C.muted,
        borderTop: `1px solid ${C.border}`,
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        alignItems: 'center',
        zIndex: 10,
      }}
    >
      {NAV.map(([label, I], i) => {
        let el: React.ReactNode = (
          <div style={{ textAlign: 'center', color: on === label ? C.brand600 : C.textMuted, fontSize: 12, fontWeight: 700 }}>
            <I size={24} weight={on === label ? 'fill' : 'regular'} style={{ display: 'block', margin: '0 auto 3px' }} />
            {label}
          </div>
        );
        if (label === tap) el = <Tapped at={tapAt}>{el}</Tapped>;
        const s = spots.find((x) => x.tab === label);
        return s ? (
          <Spot key={label} at={s.at} until={s.until} text={s.text} place="above" align={i < 2 ? 'left' : 'right'}>
            {el}
          </Spot>
        ) : (
          <div key={label}>{el}</div>
        );
      })}
    </div>
  );
};

/** Page body between the app bar and the bottom nav. */
const Body: React.FC<{ children: React.ReactNode; nav?: boolean; style?: React.CSSProperties }> = ({ children, nav, style }) => (
  <div style={{ position: 'absolute', top: 60, left: 0, right: 0, bottom: nav ? 66 : 0, overflow: 'hidden', ...style }}>
    {children}
  </div>
);

// ── product art ───────────────────────────────────────────────────────────────
type Kind = 'galon' | 'baru' | 'botol' | 'gelas';
const Art: React.FC<{ kind: Kind; size?: number }> = ({ kind, size = 90 }) => (
  <svg viewBox="0 0 100 100" width={size} height={size}>
    {kind === 'galon' || kind === 'baru' ? (
      <>
        <rect x="24" y="26" width="52" height="66" rx="14" fill="rgba(120,200,225,0.55)" stroke="#5fb4cc" strokeWidth="2" />
        <rect x="30" y="44" width="40" height="3" rx="1.5" fill="rgba(255,255,255,0.7)" />
        <rect x="30" y="64" width="40" height="3" rx="1.5" fill="rgba(255,255,255,0.7)" />
        <rect x="40" y="12" width="20" height="16" rx="4" fill={kind === 'baru' ? C.brand800 : '#1f6fa8'} />
        {kind === 'baru' && <circle cx="72" cy="30" r="10" fill={C.amber} />}
      </>
    ) : kind === 'botol' ? (
      <>
        {[22, 44, 66].map((x) => (
          <g key={x}>
            <rect x={x - 6} y="36" width="16" height="52" rx="6" fill="rgba(120,200,225,0.55)" stroke="#5fb4cc" strokeWidth="1.5" />
            <rect x={x - 2} y="26" width="8" height="11" rx="2" fill="#1f6fa8" />
          </g>
        ))}
      </>
    ) : (
      <>
        {[24, 50, 76].map((x) => (
          <path key={x} d={`M${x - 11} 50 L${x + 11} 50 L${x + 8} 84 L${x - 8} 84 Z`} fill="rgba(120,200,225,0.55)" stroke="#5fb4cc" strokeWidth="1.5" />
        ))}
      </>
    )}
  </svg>
);

interface Product {
  name: string;
  unit: string;
  sku: string;
  price: number;
  member: number;
  kind: Kind;
}
const P: Product[] = [
  { name: 'Air Galon 19L (Isi Ulang)', unit: 'Galon', sku: 'AIR-GALON-19L', price: 20000, member: 19000, kind: 'galon' },
  { name: 'Galon 19L + Air (Baru)', unit: 'Galon', sku: 'GALON-BARU-19L', price: 65000, member: 62000, kind: 'baru' },
  { name: 'Air Botol 600ml (Dus isi 24)', unit: 'Dus', sku: 'AIR-BTL-600', price: 48000, member: 45600, kind: 'botol' },
  { name: 'Air Gelas 240ml (Dus isi 48)', unit: 'Dus', sku: 'AIR-CUP-240', price: 22000, member: 20900, kind: 'gelas' },
];

const ProductCard: React.FC<{ p: Product; memberSpot?: number; tapAt?: number }> = ({ p, memberSpot, tapAt }) => {
  const chip = (
    <div
      style={{
        display: 'inline-block',
        background: C.brand50,
        color: C.brand800,
        borderRadius: 999,
        padding: '3px 9px',
        fontSize: 11.5,
        fontWeight: 800,
      }}
    >
      Member {rupiah(p.member)}
    </div>
  );
  const card = (
    <div style={{ background: C.surface, borderRadius: 20, overflow: 'hidden', border: `1px solid ${C.border}` }}>
      <div style={{ height: 112, background: C.soft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Art kind={p.kind} size={84} />
      </div>
      <div style={{ padding: '10px 12px 12px', position: 'relative' }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, lineHeight: 1.25, height: 34 }}>{p.name}</div>
        <div style={{ fontSize: 12, color: C.textMuted }}>{p.unit}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{rupiah(p.price)}</div>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 15,
              background: C.brand600,
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Plus size={17} weight="bold" />
          </div>
        </div>
        <div style={{ marginTop: 4 }}>
          {memberSpot !== undefined ? (
            <Spot at={memberSpot} until={memberSpot + 95} text="Harga khusus anggota" align="left">
              {chip}
            </Spot>
          ) : (
            chip
          )}
        </div>
      </div>
    </div>
  );
  return tapAt !== undefined ? <Tapped at={tapAt}>{card}</Tapped> : card;
};

const Stepper: React.FC<{ n: number; plusAt?: number | number[] }> = ({ n, plusAt = [] }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      border: `1px solid ${C.border}`,
      borderRadius: 999,
      padding: '7px 12px',
      background: C.surface,
    }}
  >
    <Minus size={16} color={n > 1 ? C.text : C.border} />
    <span style={{ fontSize: 16, fontWeight: 800, minWidth: 12, textAlign: 'center' }}>{n}</span>
    <Tapped at={plusAt}>
      <Plus size={16} />
    </Tapped>
  </div>
);

const Pill: React.FC<{ label: string; on: boolean; dark?: boolean }> = ({ label, on, dark }) => (
  <div
    style={{
      padding: '8px 16px',
      borderRadius: 999,
      fontSize: 14,
      fontWeight: 700,
      whiteSpace: 'nowrap',
      background: on ? (dark ? INK : C.brand50) : C.surface,
      color: on ? (dark ? 'white' : C.brand800) : C.textMuted,
      border: `1px solid ${on ? 'transparent' : C.border}`,
    }}
  >
    {label}
  </div>
);

/** A heads-up push notification sliding in from the top. Every push is titled "Hydromart". */
const Push: React.FC<{ at: number; until?: number; text: string }> = ({ at, until = 1e9, text }) => {
  const frame = useCurrentFrame();
  const p = ease(frame, at, 12) * (1 - ease(frame, until, 10));
  if (p === 0) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: 10,
        right: 10,
        top: 8 - (1 - p) * 140,
        zIndex: 60,
        background: 'rgba(255,255,255,0.97)',
        borderRadius: 18,
        padding: '10px 12px',
        boxShadow: '0 12px 30px rgba(0,0,0,0.25)',
        display: 'flex',
        gap: 10,
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          background: C.brand600,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Drop size={20} />
      </div>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 800 }}>
          Hydromart <span style={{ fontWeight: 500, color: C.textMuted }}>· sekarang</span>
        </div>
        <div style={{ fontSize: 12.5, lineHeight: 1.35, marginTop: 2 }}>{text}</div>
      </div>
    </div>
  );
};

/** The order page's 5-node progress (order.ts `progress`). `step` 0..4 may be fractional while moving. */
const Progress: React.FC<{ step: number }> = ({ step }) => {
  const labels = ['Dipesan', 'Disiapkan', 'Diambil', 'Diantar', 'Tiba'];
  return (
    <div style={{ position: 'relative', padding: '6px 4px 0' }}>
      <div style={{ position: 'absolute', left: 22, right: 22, top: 17, height: 4, background: C.border, borderRadius: 2 }} />
      <div
        style={{
          position: 'absolute',
          left: 22,
          width: `calc((100% - 44px) * ${Math.min(step, 4) / 4})`,
          top: 17,
          height: 4,
          background: C.brand600,
          borderRadius: 2,
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative' }}>
        {labels.map((l, i) => {
          const done = step >= i;
          return (
            <div key={l} style={{ width: 52, textAlign: 'center' }}>
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  margin: '0 auto',
                  background: done ? C.brand600 : C.surface,
                  border: `2px solid ${done ? C.brand600 : C.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {done && <Check size={14} weight="bold" color="white" />}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, marginTop: 4, color: done ? C.text : C.textMuted }}>{l}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Checkbox: React.FC<{ on: boolean; label: React.ReactNode; tapAt?: number }> = ({ on, label, tapAt }) => {
  const box = (
    <div
      style={{
        width: 22,
        height: 22,
        borderRadius: 6,
        flexShrink: 0,
        background: on ? C.brand600 : C.surface,
        border: `2px solid ${on ? C.brand600 : C.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {on && <Check size={14} weight="bold" color="white" />}
    </div>
  );
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13.5, lineHeight: 1.4, margin: '10px 0' }}>
      {tapAt !== undefined ? <Tapped at={tapAt}>{box}</Tapped> : box}
      <div>{label}</div>
    </div>
  );
};

// ── scenes: getting started ───────────────────────────────────────────────────
const SLIDES = [
  { I: MapPin, title: 'Atur lokasi antar', body: 'Kami carikan depot terdekat untuk antar tercepat.' },
  { I: DropIcon, title: 'Pesan galon & air', body: 'Isi ulang, air botol, dispenser — harga member otomatis.' },
  { I: Truck, title: 'Lacak sampai depan pintu', body: 'Pantau kurir real-time, bayar tunai atau non-tunai.' },
];

const Onboarding: React.FC = () => {
  const taps = [90, 190, 300];
  return (
    <Screens at={[0, 100, 200]}>
      {SLIDES.map(({ I, title, body }, i) => (
        <div key={title} style={{ position: 'absolute', inset: 0, padding: '70px 28px', textAlign: 'center' }}>
          <div
            style={{
              width: 170,
              height: 170,
              borderRadius: 85,
              background: C.brand50,
              margin: '0 auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <I size={84} weight="duotone" color={C.brand700} />
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 40, letterSpacing: -0.5 }}>{title}</div>
          <div style={{ fontSize: 15.5, color: C.textMuted, marginTop: 12, lineHeight: 1.45 }}>{body}</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 34 }}>
            {SLIDES.map((_, k) => (
              <div
                key={k}
                style={{ width: k === i ? 24 : 8, height: 8, borderRadius: 4, background: k === i ? C.brand600 : C.border }}
              />
            ))}
          </div>
          <div
            style={{
              position: 'absolute',
              left: 24,
              right: 24,
              bottom: 40,
              display: 'grid',
              gridTemplateColumns: '1fr 1.6fr',
              gap: 12,
            }}
          >
            <Btn variant="ghost">Lewati</Btn>
            <Tapped at={taps[i]}>
              <Btn style={{ padding: 14 }}>{i === 2 ? 'Mulai' : 'Lanjut'}</Btn>
            </Tapped>
          </div>
        </div>
      ))}
    </Screens>
  );
};

const Register: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Screens at={[0, 55]}>
      {[
        <LoginScreen key="l" typeFrom={1e9} tapAt={1e9} signupTapAt={38} />,
        <Scroll key="r" from={265} by={250} dur={30}>
          <div style={{ padding: '28px 22px' }}>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5 }}>Buat akun baru</div>
            <div style={{ fontSize: 14, color: C.textMuted, marginTop: 6, lineHeight: 1.4 }}>
              Kami kirim kode sekali pakai untuk verifikasi nomormu.
            </div>
            <div style={{ marginTop: 22 }}>
              <Field
                label="Nomor telepon"
                prefix="🇮🇩 +62"
                placeholder="81234567890"
                value={typed(frame, '812 3456 7890', 70, 2)}
                focus={frame >= 64 && frame < 120}
              />
              <Field
                label="Nama lengkap (Opsional)"
                placeholder="Budi Santoso"
                value={typed(frame, FULL, 130, 2)}
                focus={frame >= 124 && frame < 170}
              />
              <Field label="Email (Opsional)" placeholder="budi@example.com" value="" />
              <Spot at={185} until={258} text="Punya kode dari teman? Isi untuk bonus poin">
                <div style={{ background: C.muted }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Kode referral (opsional)</div>
                    <Chip tone="warning">+50 poin</Chip>
                  </div>
                  <Field label="" placeholder="Punya kode teman?" value="" />
                </div>
              </Spot>
            </div>
            <Spot at={300} until={395} text="Wajib dicentang untuk mendaftar" place="above">
              <div style={{ background: C.muted }}>
                <Checkbox
                  on={frame >= 333}
                  tapAt={330}
                  label="Saya menyetujui Kebijakan Privasi dan Ketentuan Layanan Hydromart."
                />
              </div>
            </Spot>
            <Checkbox on={false} label="Saya bersedia menerima info promo dan penawaran (opsional)." />
            <Tapped at={430} style={{ marginTop: 12 }}>
              <Btn style={{ padding: 14 }}>Kirim kode verifikasi</Btn>
            </Tapped>
            <div style={{ fontSize: 14, color: C.textMuted, marginTop: 14, textAlign: 'center' }}>
              Sudah punya akun? <span style={{ color: C.brand700, fontWeight: 700 }}>Masuk</span>
            </div>
          </div>
        </Scroll>,
      ]}
    </Screens>
  );
};

const Verify: React.FC = () => (
  <VerifyScreen typeFrom={25} tapAt={1e9} lead="Selesaikan pendaftaran." resendHintAt={130} />
);

// ── scenes: shopping ──────────────────────────────────────────────────────────
const HomeScreen: React.FC<{ marks?: boolean; buyAgainSpot?: number }> = ({ marks, buyAgainSpot = 1e9 }) => (
  <div style={{ position: 'absolute', inset: 0 }}>
    <AppBar
      kind="home"
      bellSpot={marks ? { at: 115, until: 170, text: 'Notifikasi pesanan & promo' } : undefined}
      cartSpot={marks ? { at: 175, until: 235, text: 'Keranjang belanja' } : undefined}
    />
    <Body nav>
      <div style={{ padding: 16 }}>
        <div style={{ background: C.brand50, borderRadius: 26, padding: '22px 20px' }}>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -1, lineHeight: 1.08 }}>Halo, {NAME}.</div>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -1, lineHeight: 1.08, color: C.brand800 }}>
            Stok galonmu aman?
          </div>
          <div style={{ fontSize: 14, color: C.textMuted, marginTop: 10, lineHeight: 1.45 }}>
            Galon isi ulang dan air botol dari depot terdekat. Pesan sekarang, kurir antar hari ini juga.
          </div>
          <Spot at={marks ? 30 : 1e9} until={110} text="Cari produk dengan mengetik namanya">
            <div
              style={{
                marginTop: 14,
                background: C.surface,
                borderRadius: 999,
                padding: 5,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: '0 10px 28px rgba(11,77,87,0.12)',
              }}
            >
              <MagnifyingGlass size={18} color={C.brand600} style={{ marginLeft: 12 }} />
              <div style={{ flex: 1, fontSize: 14, color: C.textMuted }}>Cari galon, botol, dispenser…</div>
              <div style={{ background: C.brand600, color: 'white', fontWeight: 800, borderRadius: 999, padding: '9px 18px' }}>
                Cari
              </div>
            </div>
          </Spot>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            {['Air Galon', 'Galon Isi Ulang', 'Air Botol'].map((c) => (
              <div key={c} style={{ background: 'rgba(255,255,255,0.7)', borderRadius: 999, padding: '7px 12px', fontSize: 13, fontWeight: 700, color: C.brand900 }}>
                {c}
              </div>
            ))}
          </div>
        </div>
        <Spot at={buyAgainSpot} text="Atau pilih dari Beli lagi di Beranda" place="above" style={{ marginTop: 22 }}>
          <div style={{ background: C.muted }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ fontSize: 21, fontWeight: 800 }}>Beli lagi</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.brand700 }}>Semua produk →</div>
            </div>
            <div style={{ fontSize: 13.5, color: C.textMuted, marginTop: 2 }}>Dari pesanan-pesanan terakhirmu</div>
          </div>
        </Spot>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <ProductCard p={P[0]} />
          <ProductCard p={P[2]} />
        </div>
      </div>
    </Body>
    <BottomNav
      active="Beranda"
      spots={
        marks
          ? [
              { tab: 'Beranda', at: 245, until: 285, text: 'Beranda: halaman utama' },
              { tab: 'Belanja', at: 288, until: 328, text: 'Belanja: semua produk' },
              { tab: 'Pesanan', at: 331, until: 371, text: 'Pesanan: status & riwayat' },
              { tab: 'Akun', at: 374, until: 414, text: 'Akun: profil, poin, bantuan' },
            ]
          : []
      }
    />
  </div>
);

const Home: React.FC = () => <HomeScreen marks />;

const Browse: React.FC = () => {
  const frame = useCurrentFrame();
  const filtered = frame >= 64;
  const items = filtered ? [P[0]] : P;
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <AppBar kind="search" />
      <Body nav>
        <div style={{ padding: '14px 16px 0', fontSize: 14, color: C.textMuted }}>
          Galon isi ulang dan air botol, diantar dari {DEPOT} — 1,2 km.
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '12px 0 12px 16px' }}>
          <Pill label="Semua" on={!filtered} dark />
          <Pill label="Air Galon" on={false} />
          <Tapped at={60}>
            <Pill label="Galon Isi Ulang" on={filtered} dark />
          </Tapped>
          <Pill label="Air Botol" on={false} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '0 16px' }}>
          {items.map((p, i) => (
            <ProductCard key={p.sku} p={p} memberSpot={filtered && i === 0 ? 140 : undefined} tapAt={filtered && i === 0 ? 300 : undefined} />
          ))}
        </div>
      </Body>
      <BottomNav active="Beranda" tap="Belanja" tapAt={15} />
    </div>
  );
};

const ProductPage: React.FC<{ qty: number; plusAt?: number; addAt?: number; added: boolean; cartTapAt?: number; spotAt?: number }> = ({
  qty,
  plusAt,
  addAt = -99,
  added,
  cartTapAt,
  spotAt = 1e9,
}) => {
  const p = P[0];
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <AppBar kind="back" title="" cart={added ? 1 : 0} cartTapAt={cartTapAt} />
      <Body>
        <div style={{ height: 190, background: C.soft, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <Art kind="galon" size={150} />
          <div style={{ position: 'absolute', right: 16, top: 14, width: 38, height: 38, borderRadius: 19, background: C.surface, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Heart size={20} />
          </div>
        </div>
        <div style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: -0.4 }}>{p.name}</div>
          <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 2 }}>per galon · SKU {p.sku}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{rupiah(p.price)}</div>
            <Chip tone="brand">Member {rupiah(p.member)}</Chip>
          </div>
          <Spot at={spotAt} until={spotAt + 110} text="Pastikan depot Buka & mengantar ke alamatmu" style={{ marginTop: 14 }}>
            <Card style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 14.5, fontWeight: 800 }}>Dikirim dari {DEPOT}</div>
                <Chip tone="success">Buka</Chip>
              </div>
              <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>1,2 km · ongkir {rupiah(5000)}</div>
              <div style={{ fontSize: 13, marginTop: 8, color: C.success, fontWeight: 600, lineHeight: 1.35 }}>
                Depot buka dan mengantar ke alamatmu — tiba hari ini, ±30 menit
              </div>
            </Card>
          </Spot>
          <div style={{ marginTop: 12, color: C.brand700, fontWeight: 700, fontSize: 14 }}>Jadikan langganan</div>
        </div>
      </Body>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '12px 16px 16px',
          background: C.surface,
          borderTop: `1px solid ${C.border}`,
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          zIndex: 5,
        }}
      >
        <Stepper n={qty} plusAt={plusAt} />
        <Tapped at={addAt} style={{ flex: 1 }}>
          <Btn style={{ padding: 13, fontSize: 14, background: added ? C.success : C.brand600, borderColor: added ? C.success : C.brand600 }}>
            {added ? (
              <>
                <Check size={16} weight="bold" /> Ditambahkan
              </>
            ) : (
              `Tambah ke keranjang — ${rupiah(p.price * qty)}`
            )}
          </Btn>
        </Tapped>
      </div>
      {added && (
        <div style={{ position: 'absolute', right: 18, bottom: 86, color: C.brand700, fontWeight: 800, fontSize: 14, zIndex: 5 }}>
          Ke keranjang →
        </div>
      )}
    </div>
  );
};

const ProductScene: React.FC = () => {
  const frame = useCurrentFrame();
  return <ProductPage qty={frame >= 183 ? 2 : 1} plusAt={180} addAt={240} added={frame >= 246} spotAt={40} />;
};

const Cart: React.FC = () => {
  return (
    <Screens at={[0, 40]}>
      {[
        <ProductPage key="p" qty={2} added cartTapAt={25} />,
        <div key="c" style={{ position: 'absolute', inset: 0 }}>
          <AppBar kind="back" title="Keranjang — 2 item" cart={1} />
          <Body>
            <div style={{ padding: 16, display: 'grid', gap: 12 }}>
              <Card style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ width: 58, height: 58, borderRadius: 14, background: C.soft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Art kind="galon" size={48} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 800 }}>{P[0].name}</div>
                  <div style={{ fontSize: 13, color: C.textMuted }}>{rupiah(P[0].price)}</div>
                </div>
                <Stepper n={2} />
              </Card>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>Sekalian, biar sekali antar</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  {[P[2], P[3]].map((p) => (
                    <Card key={p.sku} style={{ padding: 10, display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
                      <Art kind={p.kind} size={34} />
                      <div style={{ fontSize: 11.5, fontWeight: 700, flex: 1, lineHeight: 1.25 }}>{p.name}</div>
                      <Plus size={16} color={C.brand600} weight="bold" />
                    </Card>
                  ))}
                </div>
              </div>
              <Card style={{ padding: '6px 14px' }}>
                <div style={{ fontSize: 15, fontWeight: 800, padding: '6px 0' }}>Ringkasan</div>
                <Row k="Subtotal" v={rupiah(40000)} />
                <Row k="Diskon member (5%)" v={`− ${rupiah(2000)}`} />
                <Spot at={150} until={260} text="Ongkir belum termasuk, dihitung saat checkout" place="above">
                  <div style={{ background: C.surface }}>
                    <Row k="Estimasi total" v={rupiah(38000)} strong />
                  </div>
                </Spot>
                <div style={{ fontSize: 12, color: C.textMuted, padding: '2px 0 8px' }}>
                  Ongkir dihitung saat checkout, setelah depot ditentukan.
                </div>
              </Card>
              <div style={{ fontSize: 13, color: C.brand700, fontWeight: 700, textAlign: 'center' }}>
                Punya kode voucher? Lihat voucher kamu
              </div>
              <Tapped at={300}>
                <Btn style={{ padding: 14 }}>Checkout</Btn>
              </Tapped>
            </div>
          </Body>
        </div>,
      ]}
    </Screens>
  );
};

// ── checkout ──────────────────────────────────────────────────────────────────
interface CheckoutState {
  address?: string;
  when?: string;
  pay?: string;
  voucher?: string;
}
type CRow = 'address' | 'when' | 'pay' | 'voucher';

const CheckoutPage: React.FC<{ state: CheckoutState; tap?: CRow; tapAt?: number; scrollFrom?: number; summarySpot?: number; placeAt?: number }> = ({
  state,
  tap,
  tapAt = -99,
  scrollFrom = 1e9,
  summarySpot = 1e9,
  placeAt = -99,
}) => {
  const voucher = state.voucher ? 4000 : 0;
  const total = 40000 - 2000 - voucher + 5000;
  const rows: [CRow, string, string][] = [
    ['address', 'Alamat pengiriman', state.address ?? 'Pilih alamat'],
    ['when', 'Waktu pengiriman', state.when ?? 'Secepatnya'],
    ['pay', 'Metode pembayaran', state.pay ?? 'Bayar di tempat (COD)'],
    ['voucher', 'Voucher', state.voucher ? `${state.voucher} — hemat ${rupiah(voucher)}` : 'Masukkan kode'],
  ];
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <AppBar kind="back" title="Checkout" cart={1} />
      <Body>
        <Scroll from={scrollFrom} by={230} dur={28}>
          <div style={{ padding: 16, display: 'grid', gap: 10 }}>
            {rows.map(([id, label, value]) => {
              const row = (
                <Card style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.textMuted }}>{label}</div>
                    <div
                      style={{
                        fontSize: 14.5,
                        fontWeight: 700,
                        marginTop: 2,
                        color: id === 'address' && !state.address ? C.danger : C.text,
                      }}
                    >
                      {value}
                    </div>
                  </div>
                  <CaretRight size={18} color={C.textMuted} />
                </Card>
              );
              return id === tap ? (
                <Tapped key={id} at={tapAt}>
                  {row}
                </Tapped>
              ) : (
                <div key={id}>{row}</div>
              );
            })}
            <Card style={{ padding: '8px 14px' }}>
              <div style={{ fontSize: 15, fontWeight: 800, padding: '6px 0' }}>Ringkasan pesanan</div>
              <div style={{ fontSize: 12.5, color: C.textMuted }}>Diantar dari {DEPOT}</div>
              <Row k="Subtotal" v={rupiah(40000)} />
              <Row k="Diskon member (5%)" v={`− ${rupiah(2000)}`} />
              {state.voucher && <Row k={`Voucher ${state.voucher}`} v={`− ${rupiah(voucher)}`} />}
              <Row k={`Ongkir (est.) — ${DEPOT}`} v={rupiah(5000)} />
              <Spot at={summarySpot} until={summarySpot + 100} text="Inilah yang dibayar saat pesanan tiba" place="above">
                <div style={{ background: C.surface }}>
                  <Row k="Total" v={rupiah(total)} strong />
                </div>
              </Spot>
            </Card>
            <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.4, textAlign: 'center' }}>
              Harga diverifikasi ulang oleh depot saat pesanan dibuat — kamu tidak akan ditagih lebih.
            </div>
            <Tapped at={placeAt}>
              <Btn style={{ padding: 15, opacity: state.address ? 1 : 0.45 }}>Buat pesanan — {rupiah(total)}</Btn>
            </Tapped>
          </div>
        </Scroll>
      </Body>
    </div>
  );
};

const ADDR_SHORT = `${FULL} · Jl. Cigadung Raya No. 21`;

const Address: React.FC = () => {
  const frame = useCurrentFrame();
  const pinned = frame >= 268;
  const done = frame >= 538;
  return (
    <>
      <CheckoutPage state={{ address: done ? ADDR_SHORT : undefined }} tap="address" tapAt={30} />
      <Sheet at={42} until={530} height={690}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 19, fontWeight: 800 }}>Alamat pengiriman</div>
          <Tapped at={520}>
            <div style={{ color: C.brand700, fontWeight: 800, fontSize: 15, padding: '4px 6px' }}>Selesai</div>
          </Tapped>
        </div>
        <div style={{ height: 600, overflow: 'hidden', marginTop: 8 }}>
          <Scroll from={190} by={290} dur={30}>
            <Pill label="+ Alamat baru" on />
            <div style={{ marginTop: 12 }}>
              <Field label="Nama penerima" value={typed(frame, FULL, 70, 2)} focus={frame >= 64 && frame < 98} />
              <Field label="Telepon" value={typed(frame, '0812 3456 7890', 100, 2)} focus={frame >= 98 && frame < 130} />
              <Field label="Alamat" placeholder="Jalan, nomor, RT/RW" value={typed(frame, ADDRESS, 130, 1)} focus={frame >= 128 && frame < 170} />
              <Field label="Kota" value={frame >= 172 ? 'Bandung' : ''} />
            </div>
            <Spot at={275} until={385} text="Wajib! Kurir mengantar ke titik ini. Izinkan akses lokasi bila diminta" place="above">
              <Card style={{ padding: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>Titik lokasi antar</div>
                {pinned ? (
                  <div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: C.success, fontWeight: 800 }}>
                      <CheckCircle size={20} weight="fill" /> Lokasi tersemat ✓
                    </div>
                    <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>Akurasi ±8 m · dekat {DEPOT} · 1,2 km</div>
                  </div>
                ) : (
                  <Tapped at={238}>
                    <Btn variant="outline">
                      <Crosshair size={18} weight="bold" /> Gunakan lokasi saya
                    </Btn>
                  </Tapped>
                )}
              </Card>
            </Spot>
            <div style={{ marginTop: 12 }}>
              <Field
                label="Catatan untuk kurir"
                placeholder="mis. pagar hijau sebelah warung Bu Ani, titip ke satpam"
                value={typed(frame, 'pagar hijau sebelah warung Bu Ani', 395, 1)}
                focus={frame >= 390 && frame < 440}
              />
            </div>
            <Checkbox on={frame >= 463} tapAt={460} label="Simpan alamat ini ke buku alamat" />
          </Scroll>
        </div>
      </Sheet>
    </>
  );
};

const Schedule: React.FC = () => {
  const frame = useCurrentFrame();
  const day = frame >= 113 ? 'Besok' : 'Hari ini';
  const slot = frame >= 163;
  const days = ['Hari ini', 'Besok', 'Sel 24', 'Rab 25', 'Kam 26'];
  return (
    <>
      <CheckoutPage
        state={{ address: ADDR_SHORT, when: frame >= 300 ? 'Besok · Pagi 08.00–10.00' : undefined }}
        tap="when"
        tapAt={25}
      />
      <Sheet at={38} until={292} height={520}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 19, fontWeight: 800 }}>Waktu pengiriman</div>
          <Tapped at={282}>
            <div style={{ color: C.brand700, fontWeight: 800, fontSize: 15, padding: '4px 6px' }}>Selesai</div>
          </Tapped>
        </div>
        <Card style={{ marginTop: 12, padding: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>Antar sekarang</div>
          <div style={{ fontSize: 13, color: C.textMuted, marginTop: 2 }}>Estimasi 30–45 menit · +{rupiah(5000)}</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 6 }}>Biaya antar sekarang ditambahkan saat depot mengonfirmasi.</div>
        </Card>
        <div style={{ fontSize: 14, fontWeight: 800, margin: '16px 0 8px' }}>Atau jadwalkan</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {days.map((d) => {
            const pill = (
              <div style={{ textDecoration: d === 'Kam 26' ? 'line-through' : undefined, opacity: d === 'Kam 26' ? 0.5 : 1 }}>
                <Pill label={d} on={d === day} />
              </div>
            );
            return d === 'Besok' ? (
              <Tapped key={d} at={110}>
                {pill}
              </Tapped>
            ) : (
              <div key={d}>{pill}</div>
            );
          })}
        </div>
        <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
          {[
            ['Pagi', '08.00–10.00'],
            ['Siang', '11.00–13.00'],
            ['Sore', '15.00–17.00'],
          ].map(([p, h], i) => {
            const on = i === 0 && slot;
            const row = (
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: 14,
                  border: `1.5px solid ${on ? C.brand600 : C.border}`,
                  background: on ? C.brand50 : C.surface,
                  fontSize: 14.5,
                  fontWeight: 700,
                }}
              >
                {p} · {h}
                {on && <span style={{ color: C.brand700 }}> · dipilih</span>}
              </div>
            );
            return i === 0 ? (
              <Tapped key={p} at={160}>
                {row}
              </Tapped>
            ) : (
              <div key={p}>{row}</div>
            );
          })}
        </div>
      </Sheet>
    </>
  );
};

const PAY = [
  ['Bayar di tempat (COD)', 'Bayar ke kurir saat pesanan tiba.'],
  ['Transfer bank', 'Transfer manual, dikonfirmasi oleh depot.'],
  ['QRIS', 'Pindai untuk bayar lewat aplikasi QRIS mana pun.'],
];

const Payment: React.FC = () => {
  const frame = useCurrentFrame();
  const option = (title: string, hint: string, on: boolean) => (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 16,
        border: `1.5px solid ${on ? C.brand600 : C.border}`,
        background: on ? C.brand50 : C.surface,
        display: 'flex',
        gap: 12,
        alignItems: 'center',
      }}
    >
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          border: `2px solid ${on ? C.brand600 : C.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {on && <div style={{ width: 10, height: 10, borderRadius: 5, background: C.brand600 }} />}
      </div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 800 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 2 }}>{hint}</div>
      </div>
    </div>
  );
  return (
    <>
      <CheckoutPage state={{ address: ADDR_SHORT, when: 'Besok · Pagi 08.00–10.00' }} tap="pay" tapAt={25} />
      <Sheet at={38} until={402} height={460}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 19, fontWeight: 800 }}>Metode pembayaran</div>
          <Tapped at={392}>
            <div style={{ color: C.brand700, fontWeight: 800, fontSize: 15, padding: '4px 6px' }}>Selesai</div>
          </Tapped>
        </div>
        <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
          <Spot at={100} until={225} text="Paling umum: bayar tunai ke kurir saat pesanan tiba">
            <Tapped at={85}>{option(PAY[0][0], PAY[0][1], frame >= 88)}</Tapped>
          </Spot>
          <div style={{ height: 34 }} />
          <Spot at={235} until={385} text="Hanya muncul bila depotmu menyediakannya" place="above">
            <div style={{ display: 'grid', gap: 10 }}>
              {option(PAY[1][0], PAY[1][1], false)}
              {option(PAY[2][0], PAY[2][1], false)}
            </div>
          </Spot>
        </div>
      </Sheet>
    </>
  );
};

const Summary: React.FC = () => {
  const frame = useCurrentFrame();
  const applied = frame >= 118;
  return (
    <>
      <CheckoutPage
        state={{ address: ADDR_SHORT, when: 'Besok · Pagi 08.00–10.00', voucher: frame >= 185 ? 'HEMAT10' : undefined }}
        tap="voucher"
        tapAt={25}
        scrollFrom={200}
        summarySpot={240}
        placeAt={390}
      />
      <Sheet at={38} until={180} height={360}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 19, fontWeight: 800 }}>Voucher</div>
          <Tapped at={170}>
            <div style={{ color: C.brand700, fontWeight: 800, fontSize: 15, padding: '4px 6px' }}>Selesai</div>
          </Tapped>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginTop: 14 }}>
          <div style={{ flex: 1 }}>
            <Field label="Kode voucher" placeholder="mis. HEMAT10" value={typed(frame, 'HEMAT10', 60, 4)} focus={frame >= 55 && frame < 108} />
          </div>
          <Tapped at={108} style={{ marginBottom: 12 }}>
            <Btn style={{ padding: '11px 16px' }}>Terapkan</Btn>
          </Tapped>
        </div>
        {applied && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: C.success, fontWeight: 800, fontSize: 14 }}>
            <CheckCircle size={20} weight="fill" /> Voucher HEMAT10 — hemat {rupiah(4000)}
          </div>
        )}
      </Sheet>
    </>
  );
};

// ── after the order ───────────────────────────────────────────────────────────
const OrderPage: React.FC<{
  status: string;
  step: number;
  banner: string;
  success?: boolean;
  courier?: boolean;
  totalSpot?: number;
  extra?: React.ReactNode;
  courierSpots?: { phone?: number; share?: number };
}> = ({ status, step, banner, success, courier, totalSpot = 1e9, extra, courierSpots = {} }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <AppBar kind="back" title={ORDER} />
      <Body>
        <div style={{ padding: 16, display: 'grid', gap: 12 }}>
          {success && (
            <Card style={{ background: C.successBg, border: 'none', display: 'flex', gap: 12 }}>
              <div style={{ transform: `scale(${0.6 + ease(frame, 0, 12) * 0.4})` }}>
                <CheckCircle size={40} weight="fill" color={C.success} />
              </div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: C.success }}>Pesanan berhasil dibuat!</div>
                <div style={{ fontSize: 13, marginTop: 2, lineHeight: 1.4 }}>
                  Depot sedang menyiapkan pesananmu. Kami kabari saat kurir berangkat.
                </div>
              </div>
            </Card>
          )}
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{banner}</div>
              <Chip tone="brand">{status}</Chip>
            </div>
            <div style={{ marginTop: 12 }}>
              <Progress step={step} />
            </div>
            {success && (
              <div style={{ fontSize: 13, color: C.textMuted, marginTop: 10 }}>
                Estimasi tiba <b style={{ color: C.text }}>±30–45 menit</b>
              </div>
            )}
          </Card>
          {courier && (
            <Card style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  background: C.brand100,
                  color: C.brand800,
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                AP
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 800 }}>Andi Pratama</div>
                <div style={{ fontSize: 13, color: C.textMuted }}>Estimasi tiba · ± 08.40</div>
              </div>
              <Spot at={courierSpots.phone ?? 1e9} until={(courierSpots.phone ?? 1e9) + 100} text="Telepon kurir bila perlu" align="right">
                <Circle>
                  <Phone size={20} weight="fill" />
                </Circle>
              </Spot>
            </Card>
          )}
          {courier && (
            <Spot at={courierSpots.share ?? 1e9} until={(courierSpots.share ?? 1e9) + 100} text="Kirim link lacak ke keluarga di rumah" place="above">
              <Btn variant="outline">
                <ShareNetwork size={16} /> Bagikan link lacak
              </Btn>
            </Spot>
          )}
          <Card style={{ padding: '6px 14px' }}>
            <Row k="Air Galon 19L (Isi Ulang) × 2" v={rupiah(40000)} />
            <Row k="Ongkir" v={rupiah(5000)} />
            <Row k="Diskon" v={`− ${rupiah(6000)}`} />
            <Spot at={totalSpot} until={totalSpot + 115} text="Siapkan uang tunai sesuai total + galon kosong" place="above">
              <div style={{ background: C.surface }}>
                <Row k="Total" v={rupiah(39000)} strong />
              </div>
            </Spot>
          </Card>
          {extra}
        </div>
      </Body>
    </div>
  );
};

const PUSH = {
  confirmed: `Halo ${NAME}! Pesanan ${ORDER} sudah kami konfirmasi dan sedang kami siapkan. Terima kasih sudah memesan di Hydromart 💧`,
  onWay: `Kabar baik, ${NAME}! Pesanan ${ORDER} sedang dalam perjalanan ke alamatmu. Mohon siapkan galon kosong bila ada penukaran ya.`,
  delivered: `Pesanan ${ORDER} sudah sampai. Selamat menikmati air bersih dari Hydromart, ${NAME}! 💧`,
};

const Placed: React.FC = () => {
  const frame = useCurrentFrame();
  const confirmed = frame >= 200;
  return (
    <>
      <OrderPage
        status={confirmed ? 'Dikonfirmasi' : 'Dipesan'}
        step={0}
        banner="Pesananmu sedang diproses"
        success
      />
      <Push at={205} until={360} text={PUSH.confirmed} />
    </>
  );
};

const OrdersList: React.FC<{ tapAt?: number; againSpot?: number; againTapAt?: number; first: string; tone?: 'brand' | 'success' }> = ({
  tapAt,
  againSpot = 1e9,
  againTapAt,
  first,
  tone = 'brand',
}) => {
  const card = (no: string, status: string, date: string, t: 'brand' | 'success' | 'neutral', main: boolean) => {
    const again = (
      <Btn variant="outline" style={{ padding: '8px 12px', fontSize: 13 }}>
        Pesan lagi
      </Btn>
    );
    const body = (
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 14.5, fontWeight: 800 }}>{no}</div>
          <Chip tone={t}>{status}</Chip>
        </div>
        <div style={{ fontSize: 13, color: C.textMuted, margin: '4px 0 10px' }}>{date} · Air Galon 19L (Isi Ulang) × 2</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          {main ? (
            <Spot at={againSpot} until={againSpot + 80} text="Ulangi pesanan yang sama" align="right" place="above">
              {againTapAt !== undefined ? <Tapped at={againTapAt}>{again}</Tapped> : again}
            </Spot>
          ) : (
            again
          )}
        </div>
      </Card>
    );
    return main && tapAt !== undefined ? <Tapped at={tapAt}>{body}</Tapped> : body;
  };
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <AppBar kind="back" title="Pesanan" cart={0} />
      <Body nav>
        <div style={{ padding: 16, display: 'grid', gap: 12 }}>
          {card(ORDER, first, 'Hari ini', tone, true)}
          {card('HM-20261115-099214', 'Selesai', '15 Nov', 'success', false)}
          {card('HM-20261108-093107', 'Selesai', '8 Nov', 'success', false)}
        </div>
      </Body>
      <BottomNav active="Pesanan" />
    </div>
  );
};

const Track: React.FC = () => {
  const frame = useCurrentFrame();
  const step = 1 + ease(frame, 90, 50) * 2;
  return (
    <>
      <Screens at={[0, 62]}>
        {[
          <OrdersList key="l" tapAt={45} first="Dalam perjalanan" />,
          <OrderPage
            key="d"
            status={step >= 2.9 ? 'Dalam perjalanan' : 'Disiapkan'}
            step={step}
            banner={step >= 2.9 ? 'Pesananmu sedang dalam perjalanan' : 'Pesananmu sedang disiapkan di depot'}
            courier={frame >= 120}
            courierSpots={{ phone: 200, share: 310 }}
          />,
        ]}
      </Screens>
      <Push at={150} until={290} text={PUSH.onWay} />
    </>
  );
};

const Receive: React.FC = () => {
  const frame = useCurrentFrame();
  const arrived = frame >= 175;
  return (
    <>
      <OrderPage
        status={arrived ? 'Tiba' : 'Dalam perjalanan'}
        step={arrived ? 3 + ease(frame, 175, 15) : 3}
        banner={arrived ? 'Pesananmu sudah tiba' : 'Pesananmu sedang dalam perjalanan'}
        courier={!arrived}
        totalSpot={30}
        extra={
          frame >= 300 ? (
            <Spot at={310} text="Beri nilai setelah pesanan tiba" place="below">
              <Btn style={{ padding: 14 }}>
                <Star size={18} weight="fill" /> Nilai pesanan
              </Btn>
            </Spot>
          ) : null
        }
      />
      <Push at={185} until={300} text={PUSH.delivered} />
    </>
  );
};

const Review: React.FC = () => {
  const frame = useCurrentFrame();
  const stars = frame >= 53 ? 5 : 0;
  const hints = ['', 'Buruk', 'Kurang', 'Cukup', 'Bagus!', 'Luar biasa!'];
  const aspects = ['Kecepatan antar', 'Kondisi galon', 'Keramahan kurir', 'Akurasi pesanan'];
  const picked = (a: string) => (a === 'Kecepatan antar' && frame >= 123) || (a === 'Keramahan kurir' && frame >= 153);
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <AppBar kind="back" title="Nilai pesanan" />
      <Body>
        <div style={{ padding: '24px 18px', textAlign: 'center' }}>
          <div style={{ fontSize: 21, fontWeight: 800 }}>Bagaimana antaran Andi Pratama?</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 18 }}>
            {[1, 2, 3, 4, 5].map((n) => {
              const s = <Star size={44} weight={n <= stars ? 'fill' : 'regular'} color={n <= stars ? C.amber : C.border} />;
              return n === 5 ? (
                <Tapped key={n} at={50}>
                  {s}
                </Tapped>
              ) : (
                <div key={n}>{s}</div>
              );
            })}
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.warning, height: 24, marginTop: 8 }}>{hints[stars]}</div>
          <div style={{ fontSize: 15, fontWeight: 800, marginTop: 18, textAlign: 'left' }}>Apa yang bagus?</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {aspects.map((a) => {
              const pill = <Pill label={a} on={picked(a)} />;
              const at = a === 'Kecepatan antar' ? 120 : a === 'Keramahan kurir' ? 150 : undefined;
              return at !== undefined ? (
                <Tapped key={a} at={at}>
                  {pill}
                </Tapped>
              ) : (
                <div key={a}>{pill}</div>
              );
            })}
          </div>
          <div
            style={{
              marginTop: 16,
              height: 80,
              borderRadius: 14,
              border: `1px solid ${C.border}`,
              background: C.surface,
              textAlign: 'left',
              padding: 12,
              fontSize: 14,
              color: C.textMuted,
            }}
          >
            Tulis komentar (opsional)…
          </div>
          <Tapped at={225} style={{ marginTop: 16 }}>
            <Btn style={{ padding: 14 }}>Kirim ulasan</Btn>
          </Tapped>
        </div>
      </Body>
      <Toast at={240}>Terima kasih atas ulasanmu!</Toast>
    </div>
  );
};

const Reorder: React.FC = () => (
  <Screens at={[0, 175]}>
    {[
      <OrdersList key="l" first="Selesai" tone="success" againSpot={35} againTapAt={125} />,
      <HomeScreen key="h" buyAgainSpot={190} />,
    ]}
  </Screens>
);

const Cancel: React.FC = () => {
  const frame = useCurrentFrame();
  const reasons = ['Salah alamat / pesanan', 'Berubah pikiran', 'Terlalu lama', 'Lainnya'];
  const actions = (late: boolean) =>
    late ? (
      <Card style={{ background: C.warningBg, border: 'none' }}>
        <div style={{ fontSize: 13.5, lineHeight: 1.45 }}>
          Kurir sudah ditugaskan, jadi pesanan tidak bisa lagi dibatalkan dari sini. Depot masih bisa menghentikannya.
        </div>
        <Spot at={380} text="Hubungi depot lewat WhatsApp" style={{ marginTop: 10 }}>
          <Btn>
            <WhatsappLogo size={18} weight="fill" /> Hubungi depot
          </Btn>
        </Spot>
      </Card>
    ) : (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Spot at={20} until={95} text="Ubah hari & jam antar" align="left" place="above">
          <Btn variant="outline">Jadwalkan ulang</Btn>
        </Spot>
        <Tapped at={110}>
          <Btn variant="danger">Batalkan pesanan</Btn>
        </Tapped>
      </div>
    );
  return (
    <Screens at={[0, 330]}>
      {[
        <div key="a" style={{ position: 'absolute', inset: 0 }}>
          <OrderPage status="Dikonfirmasi" step={0} banner="Pesananmu sedang diproses" extra={actions(false)} />
          <Sheet at={122} height={470}>
            <div style={{ fontSize: 19, fontWeight: 800 }}>Batalkan pesanan?</div>
            <div style={{ fontSize: 13, color: C.textMuted, marginTop: 6, lineHeight: 1.4 }}>
              Masih bisa dibatalkan karena depot belum menyiapkan pesanan. Dana yang sudah dibayar akan direfund.
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, margin: '14px 0 8px' }}>Alasan</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {reasons.map((r) => {
                const on = r === 'Berubah pikiran' && frame >= 203;
                const row = (
                  <div
                    style={{
                      padding: '11px 14px',
                      borderRadius: 12,
                      fontSize: 14,
                      fontWeight: 600,
                      border: `1.5px solid ${on ? C.brand600 : C.border}`,
                      background: on ? C.brand50 : C.surface,
                    }}
                  >
                    {r}
                  </div>
                );
                return r === 'Berubah pikiran' ? (
                  <Tapped key={r} at={200}>
                    {row}
                  </Tapped>
                ) : (
                  <div key={r}>{row}</div>
                );
              })}
            </div>
            <Spot at={250} text="Ketuk untuk membatalkan" place="above" style={{ marginTop: 14 }}>
              <Btn style={{ background: C.danger, borderColor: C.danger, padding: 14 }}>Batalkan pesanan</Btn>
            </Spot>
          </Sheet>
        </div>,
        <OrderPage key="b" status="Kurir ditugaskan" step={1} banner="Kurir sedang menuju depot" extra={actions(true)} />,
      ]}
    </Screens>
  );
};

// ── account & extras ──────────────────────────────────────────────────────────
const ACCOUNT_MENU = ['Pesanan', 'Alamat', 'Rewards', 'Voucher kamu', 'Favorit', 'Langganan', 'Ajak teman', 'Notifikasi', 'Bantuan'];

const AccountPage: React.FC<{ tap: string; tapAt: number }> = ({ tap, tapAt }) => (
  <div style={{ position: 'absolute', inset: 0 }}>
    <AppBar kind="back" title="Akun" />
    <Body nav>
      <div style={{ padding: 16 }}>
        <Card style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              background: C.brand800,
              color: 'white',
              fontWeight: 800,
              fontSize: 17,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            BS
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{FULL}</div>
            <div style={{ fontSize: 13, color: C.textMuted }}>+62 812 3456 7890</div>
          </div>
          <div style={{ color: C.brand700, fontWeight: 800, fontSize: 14 }}>Ubah</div>
        </Card>
        <Card style={{ padding: '2px 16px', marginTop: 12 }}>
          {ACCOUNT_MENU.map((m, i) => {
            const row = (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '11px 0',
                  fontSize: 14.5,
                  fontWeight: 600,
                  borderBottom: i < ACCOUNT_MENU.length - 1 ? `1px solid ${C.border}` : undefined,
                  background: C.surface,
                }}
              >
                {m} <CaretRight size={16} color={C.textMuted} />
              </div>
            );
            return m === tap ? (
              <Tapped key={m} at={tapAt}>
                {row}
              </Tapped>
            ) : (
              <div key={m}>{row}</div>
            );
          })}
        </Card>
      </div>
    </Body>
    <BottomNav active="Beranda" tap="Akun" tapAt={8} />
  </div>
);

const Subscribe: React.FC = () => {
  const frame = useCurrentFrame();
  const freq = [
    ['Mingguan', 'tiap 7 hari'],
    ['2 minggu', 'tiap 14 hari'],
    ['Bulanan', 'tiap 30 hari'],
  ];
  return (
    <Screens at={[0, 55, 330]}>
      {[
        <AccountPage key="a" tap="Langganan" tapAt={40} />,
        <div key="f" style={{ position: 'absolute', inset: 0 }}>
          <AppBar kind="back" title="Langganan" />
          <Body>
            <Scroll from={205} by={170} dur={26}>
              <div style={{ padding: 16 }}>
                <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: -0.4 }}>Galon rutin, tanpa perlu ingat</div>
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Produk</div>
                  <Tapped at={88}>
                    <Card style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
                      <Art kind="galon" size={30} />
                      <div style={{ flex: 1, fontSize: 14.5, fontWeight: 700, color: frame >= 92 ? C.text : C.textMuted }}>
                        {frame >= 92 ? P[0].name : 'Pilih produk'}
                      </div>
                      <CaretRight size={16} />
                    </Card>
                  </Tapped>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>Jumlah</div>
                  <Stepper n={frame >= 133 ? 2 : 1} plusAt={130} />
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, margin: '14px 0 6px' }}>Frekuensi</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  {freq.map(([f, sub], i) => {
                    const on = i === 0 && frame >= 173;
                    const box = (
                      <div
                        style={{
                          padding: '10px 6px',
                          borderRadius: 14,
                          textAlign: 'center',
                          border: `1.5px solid ${on ? C.brand600 : C.border}`,
                          background: on ? C.brand50 : C.surface,
                        }}
                      >
                        <div style={{ fontSize: 14, fontWeight: 800 }}>{f}</div>
                        <div style={{ fontSize: 11.5, color: C.textMuted }}>{sub}</div>
                      </div>
                    );
                    return i === 0 ? (
                      <Tapped key={f} at={170}>
                        {box}
                      </Tapped>
                    ) : (
                      <div key={f}>{box}</div>
                    );
                  })}
                </div>
                <div style={{ marginTop: 14 }}>
                  <Field label="Pengiriman pertama" value="Sen, 23 Nov 2026" />
                </div>
                <Card style={{ padding: '10px 14px' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.textMuted }}>Antar ke</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>Rumah · Jl. Cigadung Raya No. 21</div>
                    <div style={{ fontSize: 13, color: C.brand700, fontWeight: 800 }}>Ganti alamat</div>
                  </div>
                </Card>
                <div style={{ fontSize: 13.5, color: C.success, fontWeight: 700, margin: '12px 0' }}>
                  Hemat 5% tiap pengiriman langganan.
                </div>
                <Tapped at={285}>
                  <Btn style={{ padding: 14 }}>Mulai langganan</Btn>
                </Tapped>
              </div>
            </Scroll>
          </Body>
          <Toast at={300}>Langganan dibuat.</Toast>
        </div>,
        <div key="s" style={{ position: 'absolute', inset: 0 }}>
          <AppBar kind="back" title="Langganan" />
          <Body>
            <div style={{ padding: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 10 }}>Langganan aktif</div>
              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>{P[0].name}</div>
                  <Chip tone="success">Aktif</Chip>
                </div>
                <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>2× galon · Mingguan</div>
                <div style={{ fontSize: 13.5, marginTop: 6 }}>
                  Berikutnya: <b>Sen, 23 Nov 2026</b>
                </div>
                <Spot at={380} text="Jeda atau batalkan kapan saja" place="below" style={{ marginTop: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <Btn variant="outline">Jeda</Btn>
                    <Btn variant="danger">Batalkan</Btn>
                  </div>
                </Spot>
              </Card>
            </div>
          </Body>
        </div>,
      ]}
    </Screens>
  );
};

const REWARDS = [
  { name: 'Gratis 1 galon isi ulang', cost: 150 },
  { name: 'Tumbler Hydromart', cost: 200 },
];

const Rewards: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <>
      <Screens at={[0, 330]}>
        {[
          <div key="r" style={{ position: 'absolute', inset: 0 }}>
            <AppBar kind="back" title="Rewards & poin" />
            <Body>
              <Scroll from={120} by={330} dur={32}>
                <div style={{ padding: 16, display: 'grid', gap: 12 }}>
                  <div style={{ borderRadius: 24, padding: 20, color: 'white', background: `linear-gradient(135deg, ${C.brand800}, ${C.brand600})` }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 800, letterSpacing: 1, opacity: 0.85 }}>
                      <Medal size={18} weight="fill" /> KEANGGOTAAN
                    </div>
                    <div style={{ fontSize: 36, fontWeight: 800, marginTop: 6, letterSpacing: -1 }}>REGULAR</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, marginTop: 10 }}>
                      <span>
                        Menuju <b>SILVER</b>
                      </span>
                      <b>250 / 1.000 poin</b>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.25)', marginTop: 8 }}>
                      <div style={{ width: `${25 * ease(frame, 20, 30)}%`, height: 6, borderRadius: 3, background: '#7fe0ee' }} />
                    </div>
                  </div>
                  <div style={{ borderRadius: 24, padding: 20, background: INK, color: 'white' }}>
                    <div style={{ fontSize: 14, opacity: 0.7, fontWeight: 700 }}>Poin kamu</div>
                    <div style={{ fontSize: 44, fontWeight: 800 }}>
                      250 <span style={{ fontSize: 18, color: '#5ccbdd' }}>poin</span>
                    </div>
                    <div style={{ background: '#5ccbdd', color: INK, borderRadius: 999, padding: 12, textAlign: 'center', fontWeight: 800, marginTop: 8 }}>
                      Tukar poin →
                    </div>
                  </div>
                  <div style={{ display: 'flex', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 999, padding: 4 }}>
                    {['Tukar poin', 'Voucher', 'Riwayat'].map((t, i) => (
                      <div
                        key={t}
                        style={{
                          flex: 1,
                          textAlign: 'center',
                          padding: '8px 0',
                          borderRadius: 999,
                          fontWeight: 800,
                          fontSize: 14,
                          background: i === 0 ? C.brand600 : 'transparent',
                          color: i === 0 ? 'white' : C.textMuted,
                        }}
                      >
                        {t}
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{ fontSize: 21, fontWeight: 800 }}>Tukar poin</div>
                    <div style={{ fontSize: 13, color: C.textMuted, marginTop: 2 }}>Tukarkan poinmu dengan hadiah dan potongan belanja.</div>
                  </div>
                  {REWARDS.map((r, i) => (
                    <Card key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 52, height: 52, borderRadius: 14, background: C.soft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Art kind="galon" size={40} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 800 }}>{r.name}</div>
                        <div style={{ fontSize: 13, color: C.textMuted }}>{r.cost} poin</div>
                      </div>
                      {i === 0 ? (
                        <Tapped at={200}>
                          <Btn style={{ padding: '8px 16px' }}>Tukar</Btn>
                        </Tapped>
                      ) : (
                        <Btn style={{ padding: '8px 16px' }}>Tukar</Btn>
                      )}
                    </Card>
                  ))}
                </div>
              </Scroll>
            </Body>
            <Sheet at={212} until={300} height={330}>
              <div style={{ fontSize: 19, fontWeight: 800 }}>Ambil hadiah di mana?</div>
              <div style={{ fontSize: 13, color: C.textMuted, marginTop: 6, lineHeight: 1.4 }}>
                Pilih depot tempat kamu akan mengambil hadiah. Petugas depot itu yang akan melihat penukaranmu di antrean mereka.
              </div>
              <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
                <Tapped at={262}>
                  <Pill label={`${DEPOT} · 1,2 km`} on={frame >= 265} />
                </Tapped>
                <Pill label="Depot Dipatiukur · 2,8 km" on={false} />
              </div>
            </Sheet>
            <Toast at={300}>Gratis 1 galon isi ulang berhasil ditukar!</Toast>
          </div>,
          <div key="p" style={{ position: 'absolute', inset: 0 }}>
            <AppBar kind="back" title="Penukaran saya" />
            <Body>
              <div style={{ padding: 16, display: 'grid', gap: 12 }}>
                <Card>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>Gratis 1 galon isi ulang</div>
                  <div style={{ fontSize: 13, color: C.textMuted }}>{DEPOT}</div>
                  <Spot at={350} until={440} text="Tunjukkan ke petugas depot" place="below" style={{ marginTop: 10 }}>
                    <div style={{ background: C.brand50, borderRadius: 14, padding: 14, textAlign: 'center' }}>
                      <Label>Kode</Label>
                      <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: 6, color: C.brand800 }}>7K2Q</div>
                    </div>
                  </Spot>
                  <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 8 }}>
                    Tunjukkan kode ini ke petugas depot saat mengambil hadiah.
                  </div>
                </Card>
                <Spot at={450} text="Jangan biarkan poinmu hangus" place="below">
                  <Card style={{ background: C.warningBg, border: 'none' }}>
                    <div style={{ fontSize: 14, fontWeight: 800 }}>Cara kerja poin</div>
                    <div style={{ fontSize: 13, marginTop: 4 }}>Poin hangus setelah 12 bulan tanpa aktivitas.</div>
                  </Card>
                </Spot>
              </div>
            </Body>
          </div>,
        ]}
      </Screens>
    </>
  );
};

const Referral: React.FC = () => {
  const frame = useCurrentFrame();
  const copied = frame >= 93;
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <AppBar kind="back" title="Ajak teman" />
      <Body>
        <div style={{ padding: 16, display: 'grid', gap: 12 }}>
          <Card style={{ textAlign: 'center', padding: 22 }}>
            <Label>Kode referral kamu</Label>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 8 }}>
              <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 3, color: C.brand800 }}>BUDI7Q2K</div>
              <Tapped at={90}>
                <Circle>{copied ? <Check size={20} weight="bold" /> : <Copy size={20} />}</Circle>
              </Tapped>
            </div>
            <div style={{ fontSize: 13.5, color: C.textMuted, marginTop: 12, lineHeight: 1.45 }}>
              Bagikan kode ini. Setelah pesanan pertama temanmu selesai, kamu dapat 100 poin dan temanmu dapat 50 poin. Bukan
              potongan harga.
            </div>
          </Card>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {[
              ['Diundang', '3'],
              ['Berhasil', '1'],
              ['Poin', '100'],
            ].map(([k, v]) => (
              <Card key={k} style={{ textAlign: 'center', padding: 12 }}>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{v}</div>
                <Label>{k}</Label>
              </Card>
            ))}
          </div>
          <Spot at={150} text="Kirim kodenya lewat WhatsApp atau chat" place="below">
            <Card style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <ChatCircleText size={26} color={C.brand700} />
              <div style={{ fontSize: 13.5, lineHeight: 1.4 }}>Teman memasukkan kode ini di kolom Kode referral saat mendaftar.</div>
            </Card>
          </Spot>
        </div>
      </Body>
    </div>
  );
};

const Help: React.FC = () => (
  <Screens at={[0, 55]}>
    {[
      <AccountPage key="a" tap="Bantuan" tapAt={40} />,
      <div key="h" style={{ position: 'absolute', inset: 0 }}>
        <AppBar kind="back" title="Bantuan" />
        <Body>
          <div style={{ padding: 16, display: 'grid', gap: 12 }}>
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                border: `1px solid ${C.border}`,
                borderRadius: 999,
                padding: '10px 14px',
                background: C.surface,
                color: C.textMuted,
                fontSize: 14,
              }}
            >
              <MagnifyingGlass size={17} /> Cari bantuan…
            </div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Topik</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {['Lacak & masalah pengiriman', 'Pembayaran & refund', 'Galon, deposit & tukar', 'Akun & keamanan'].map((t) => (
                <Pill key={t} label={t} on={false} />
              ))}
            </div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Pertanyaan umum</div>
            <Card style={{ padding: '2px 14px' }}>
              {['Bagaimana cara tukar galon kosong?', 'Bisakah ubah alamat setelah pesan?', 'Apa itu poin & tier membership?'].map((q, i) => (
                <div
                  key={q}
                  style={{
                    padding: '11px 0',
                    fontSize: 14,
                    fontWeight: 600,
                    display: 'flex',
                    justifyContent: 'space-between',
                    borderBottom: i < 2 ? `1px solid ${C.border}` : undefined,
                  }}
                >
                  {q} <Plus size={16} color={C.textMuted} />
                </div>
              ))}
            </Card>
            <Spot at={120} until={225} text="Chat langsung dengan CS lewat WhatsApp" place="above">
              <Btn>
                <WhatsappLogo size={18} weight="fill" /> Chat dengan CS
              </Btn>
            </Spot>
            <Spot at={235} text="Laporkan masalah pesanan di sini" place="below">
              <Card style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 800 }}>Komplain saya</div>
                <Btn variant="outline" style={{ padding: '8px 12px', fontSize: 13 }}>
                  Ajukan komplain
                </Btn>
              </Card>
            </Spot>
          </div>
        </Body>
      </div>,
    ]}
  </Screens>
);

export const PELANGGAN_SCREENS: Record<string, React.FC> = {
  onboarding: Onboarding,
  register: Register,
  verify: Verify,
  home: Home,
  browse: Browse,
  product: ProductScene,
  cart: Cart,
  address: Address,
  schedule: Schedule,
  payment: Payment,
  summary: Summary,
  placed: Placed,
  track: Track,
  receive: Receive,
  review: Review,
  reorder: Reorder,
  cancel: Cancel,
  subscribe: Subscribe,
  rewards: Rewards,
  referral: Referral,
  help: Help,
};

export const PELANGGAN_TITLE = {
  kicker: 'Tutorial Aplikasi Hydromart',
  bullets: ['Daftar & masuk', 'Pilih produk & keranjang', 'Checkout: alamat, waktu, bayar', 'Lacak, terima & beri nilai', 'Langganan, poin & bantuan'],
  outroBullets: ['Belanja → keranjang → Checkout', 'Pasang titik lokasi & patokan', 'Lacak di menu Pesanan', 'Hemat dengan langganan & poin'],
};
