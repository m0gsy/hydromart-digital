// Video 4 — Absensi: face attendance and the courier shift check-in, with the location fix staff
// actually needed on 2026-11-25 (44 of 56 phones on Android's "Perkiraan"; PRs #1076, #1079,
// #1081). Targets Ops v1.16.3. App labels: apps/web/src/lib/dictionaries/id/{hrFix,driver,
// courierFix}.ts and services/{delivery,hr}-service messages. The Android dialog, Settings and
// quick-settings screens are illustrations of stock Android 12+; menu names vary by phone brand,
// which the narration says.
import React from 'react';
import { useCurrentFrame } from 'remotion';
import {
  ArrowLeft,
  ArrowsClockwise,
  BatteryFull,
  Bell,
  Bluetooth,
  Camera,
  CheckCircle,
  CloudSlash,
  Flashlight,
  Gear,
  Hourglass,
  ImageSquare,
  Info,
  MagnifyingGlass,
  MapPin,
  MapPinArea,
  NavigationArrow,
  Phone as PhoneIcon,
  ShieldCheck,
  SmileySad,
  Storefront,
  UserFocus,
  WarningCircle,
  WifiHigh,
  XCircle,
  type Icon,
} from '@phosphor-icons/react';
import { DriverHome } from './StaffDepot';
import { EnrollScreen, FaceCheck, HrHome } from './shared';
import { Btn, C, Card, Drop, ease, FONT, Screens, Spot, Tapped } from './ui';

const NAME = 'Andi Pratama';
const DEPOT = 'Depot Dago';
const HINT_V163 = 'Tatap kamera dan tahan sebentar saat menekan Ambil Foto.';

// Android system UI (an illustration, not Hydromart's own screens).
const A = { bg: '#f3f4fa', card: '#ffffff', text: '#1b1b1f', muted: '#5f6070', blue: '#3a5bd9', blueBg: '#e3e8fb', line: '#e4e5ee' };

// ── Hydromart Ops pieces ──────────────────────────────────────────────────────
/** hrFix.preciseLocation (PR #1081): the amber notice on both check-in screens. */
const PreciseNotice: React.FC = () => (
  <div
    style={{
      display: 'flex',
      gap: 10,
      alignItems: 'flex-start',
      background: C.warningBg,
      color: '#7a560c',
      borderRadius: 16,
      padding: '11px 13px',
      fontSize: 12,
      lineHeight: 1.4,
    }}
  >
    <MapPinArea size={18} weight="fill" style={{ flexShrink: 0, marginTop: 1 }} />
    <div>
      <b>Lokasi HP masih "Perkiraan".</b> Lokasi seperti ini bisa meleset beberapa kilometer, jadi kehadiranmu di depot tidak
      terbukti dan check-in shift akan ditolak. Ubah ke "Tepat": Setelan HP → Aplikasi → Hydromart Ops → Izin → Lokasi →
      nyalakan "Gunakan lokasi akurat".
    </div>
  </div>
);

/** delivery-service NotAtDepotError on a grid fix (PR #1076). */
const REFUSAL =
  'Lokasi HP kamu masih "Perkiraan" (bisa meleset beberapa kilometer), jadi tidak bisa membuktikan kamu di depot. ' +
  'Buka Setelan HP → Aplikasi → Hydromart Ops → Izin → Lokasi, nyalakan "Gunakan lokasi akurat", lalu coba lagi.';

/** /driver/shift/check-in. */
const ShiftScreen: React.FC<{
  verified: boolean;
  notice?: boolean;
  noticeSpot?: { at: number; until?: number; text: string };
  checkSpot?: { at: number; until?: number; text: string };
  tapAt?: number;
  errorAt?: number;
  errorSpot?: { at: number; text: string };
}> = ({ verified, notice, noticeSpot, checkSpot, tapAt = -99, errorAt = 1e9, errorSpot }) => {
  const frame = useCurrentFrame();
  const place = (
    <Card style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, background: C.surface }}>
      {verified ? <CheckCircle size={24} weight="fill" color={C.success} /> : <MapPin size={24} weight="fill" color={C.warning} />}
      <div>
        <div style={{ fontSize: 14.5, fontWeight: 800 }}>Depot penempatan</div>
        <div style={{ fontSize: 12.5, color: C.textMuted }}>{verified ? `${DEPOT} · Lokasi terverifikasi` : DEPOT}</div>
      </div>
    </Card>
  );
  const err = (
    <div style={{ background: C.dangerBg, color: C.danger, borderRadius: 14, padding: '10px 12px', fontSize: 12, lineHeight: 1.4, display: 'flex', gap: 8 }}>
      <WarningCircle size={18} weight="fill" style={{ flexShrink: 0 }} />
      {REFUSAL}
    </div>
  );
  return (
    <div style={{ padding: '22px 20px' }}>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5 }}>Selamat datang, {NAME}</div>
      <div style={{ fontSize: 13.5, color: C.textMuted, marginTop: 4, lineHeight: 1.4 }}>
        Check-in di depot untuk memulai shift dan menerima tugas.
      </div>
      <div style={{ display: 'grid', gap: 9, marginTop: 14 }}>
        {checkSpot ? <Spot {...checkSpot}>{place}</Spot> : place}
        <Card style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12 }}>
          <CheckCircle size={24} weight="fill" color={C.success} />
          <div style={{ fontSize: 14.5, fontWeight: 800 }}>Kendaraan · Motor</div>
        </Card>
        <Card style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12 }}>
          <CheckCircle size={24} weight="fill" color={C.success} />
          <div style={{ fontSize: 14.5, fontWeight: 800 }}>Baterai HP 82%</div>
        </Card>
        {notice &&
          (noticeSpot ? (
            <Spot {...noticeSpot} place="above">
              <PreciseNotice />
            </Spot>
          ) : (
            <PreciseNotice />
          ))}
        <Tapped at={tapAt}>
          <Btn style={{ padding: 14 }}>Mulai shift · check-in</Btn>
        </Tapped>
        {frame >= errorAt && (
          <div style={{ opacity: ease(frame, errorAt, 10) }}>
            {errorSpot ? (
              <Spot at={errorSpot.at} text={errorSpot.text} place="above">
                {err}
              </Spot>
            ) : (
              err
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Android pieces ────────────────────────────────────────────────────────────
const AndroidBar: React.FC<{ title: string; big?: boolean }> = ({ title, big }) => (
  <div style={{ padding: big ? '34px 22px 14px' : '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
    {!big && <ArrowLeft size={22} color={A.text} />}
    <div style={{ fontSize: big ? 32 : 20, fontWeight: big ? 600 : 500, color: A.text, fontFamily: 'system-ui, sans-serif' }}>{title}</div>
  </div>
);

const AppIcon: React.FC<{ size?: number; ops?: boolean }> = ({ size = 48, ops = true }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.3,
      background: ops ? C.brand800 : C.brand600,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
    }}
  >
    <Drop size={size * 0.6} />
    {ops && (
      <div
        style={{
          position: 'absolute',
          bottom: -2,
          right: -2,
          background: C.amber,
          color: '#1f1400',
          fontSize: size * 0.2,
          fontWeight: 800,
          borderRadius: 6,
          padding: '1px 4px',
        }}
      >
        OPS
      </div>
    )}
  </div>
);

/** One row of an Android settings list. */
const ARow: React.FC<{ icon?: Icon; color?: string; title: string; sub?: string; right?: React.ReactNode; app?: boolean }> = ({
  icon: I,
  color = A.blue,
  title,
  sub,
  right,
  app,
}) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '13px 20px', background: A.bg, fontFamily: 'system-ui, sans-serif' }}>
    {app ? (
      <AppIcon size={36} />
    ) : I ? (
      <div style={{ width: 38, height: 38, borderRadius: 19, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <I size={20} color="white" weight="fill" />
      </div>
    ) : null}
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 16.5, color: A.text }}>{title}</div>
      {sub && <div style={{ fontSize: 13, color: A.muted, marginTop: 2 }}>{sub}</div>}
    </div>
    {right}
  </div>
);

const Toggle: React.FC<{ on: number }> = ({ on }) => (
  <div style={{ width: 52, height: 30, borderRadius: 15, background: on > 0.5 ? A.blue : '#c7c8d4', position: 'relative' }}>
    <div
      style={{
        position: 'absolute',
        top: 3,
        left: 3 + on * 22,
        width: 24,
        height: 24,
        borderRadius: 12,
        background: 'white',
        boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
      }}
    />
  </div>
);

const Radio: React.FC<{ on: boolean; label: string }> = ({ on, label }) => (
  <div style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '13px 20px', background: A.bg, fontFamily: 'system-ui, sans-serif' }}>
    <div
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        border: `2px solid ${on ? A.blue : A.muted}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {on && <div style={{ width: 12, height: 12, borderRadius: 6, background: A.blue }} />}
    </div>
    <div style={{ fontSize: 16, color: A.text }}>{label}</div>
  </div>
);

const AndroidScreen: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ position: 'absolute', inset: 0, background: A.bg }}>{children}</div>
);

/** A finger held down at the centre of its parent from `at` for `hold` frames. */
const LongPress: React.FC<{ at: number; hold?: number }> = ({ at, hold = 30 }) => {
  const frame = useCurrentFrame();
  if (frame < at - 8 || frame > at + hold + 12) return null;
  const p = ease(frame, at, hold);
  return (
    <div style={{ position: 'absolute', left: '50%', top: '50%', zIndex: 50, pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          width: 44 + p * 30,
          height: 44 + p * 30,
          left: -(22 + p * 15),
          top: -(22 + p * 15),
          borderRadius: '50%',
          border: `3px solid ${C.brand600}`,
          background: 'rgba(22,40,46,0.25)',
          opacity: 1 - ease(frame, at + hold, 12),
        }}
      />
    </div>
  );
};

// ── boards (no phone) ─────────────────────────────────────────────────────────
const Pop: React.FC<{ at: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ at, children, style }) => {
  const p = ease(useCurrentFrame(), at, 14);
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * 30}px) scale(${0.96 + p * 0.04})`, ...style }}>{children}</div>;
};

const Why: React.FC = () => {
  const frame = useCurrentFrame();
  const jump = ease(frame, 380, 45);
  const depot = { x: 330, y: 470 };
  const far = { x: 790, y: 120 };
  const dot = { x: depot.x + (far.x - depot.x) * jump, y: depot.y + 18 + (far.y - depot.y - 18) * jump };
  const grid = ease(frame, 368, 20);
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div style={{ position: 'relative', height: 1000, borderRadius: 40, overflow: 'hidden', background: '#e7eee9', opacity: ease(frame, 0, 15) }}>
        <svg viewBox="0 0 952 1000" width="952" height="1000" style={{ position: 'absolute', inset: 0 }}>
          <path d="M0 300 H952 M0 640 H952 M180 0 V1000 M520 0 V1000 M840 0 V1000 M0 900 L952 160" stroke="#fff" strokeWidth="26" />
          {[0, 1, 2, 3].map((i) => (
            <g key={i} opacity={grid * 0.9}>
              <line x1={i * 310 + 170} y1="0" x2={i * 310 + 170} y2="1000" stroke={C.amber} strokeWidth="3" strokeDasharray="14 12" />
              <line x1="0" y1={i * 310 + 120} x2="952" y2={i * 310 + 120} stroke={C.amber} strokeWidth="3" strokeDasharray="14 12" />
            </g>
          ))}
          <circle cx={depot.x} cy={depot.y} r="92" fill="rgba(24,115,74,0.14)" stroke={C.success} strokeWidth="4" strokeDasharray="10 8" />
          {jump > 0.05 && (
            <line x1={depot.x} y1={depot.y + 18} x2={dot.x} y2={dot.y} stroke={C.danger} strokeWidth="5" strokeDasharray="16 10" />
          )}
        </svg>
        <div style={{ position: 'absolute', left: depot.x - 46, top: depot.y - 140, width: 92, textAlign: 'center' }}>
          <div style={{ width: 84, height: 84, borderRadius: 24, background: C.brand800, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 24px rgba(0,0,0,0.25)' }}>
            <Storefront size={50} color="white" weight="fill" />
          </div>
        </div>
        <div style={{ position: 'absolute', left: depot.x + 98, top: depot.y - 30, color: C.success, fontWeight: 800, fontSize: 30 }}>
          Area depot
        </div>
        {frame >= 202 && (
          <div
            style={{
              position: 'absolute',
              left: depot.x - 22,
              top: depot.y - 4,
              width: 44,
              height: 44,
              borderRadius: 22,
              background: C.success,
              border: '6px solid white',
              transform: `scale(${ease(frame, 202, 10)})`,
              boxShadow: `0 0 0 ${10 + Math.sin(frame / 6) * 6}px rgba(24,115,74,0.25)`,
            }}
          />
        )}
        {frame >= 230 && (
          <div
            style={{
              position: 'absolute',
              left: dot.x - 24,
              top: dot.y - 24,
              width: 48,
              height: 48,
              borderRadius: 24,
              background: C.amber,
              border: '6px solid white',
              transform: `scale(${ease(frame, 230, 10)})`,
            }}
          />
        )}
        {frame >= 430 && (
          <Pop at={430} style={{ position: 'absolute', left: 520, top: 200 }}>
            <div style={{ background: C.danger, color: 'white', borderRadius: 18, padding: '10px 18px', fontWeight: 800, fontSize: 34 }}>± 1.400 m</div>
          </Pop>
        )}
        {frame >= 640 && (
          <Pop at={640} style={{ position: 'absolute', left: 470, top: 26 }}>
            <div style={{ background: 'white', color: C.danger, borderRadius: 18, padding: '10px 18px', fontWeight: 800, fontSize: 30, display: 'flex', gap: 10, alignItems: 'center' }}>
              <XCircle size={36} weight="fill" /> Check-in ditolak
            </div>
          </Pop>
        )}
        {frame >= 560 && (
          <Pop at={560} style={{ position: 'absolute', left: depot.x - 140, top: depot.y + 110 }}>
            <div style={{ background: C.text, color: 'white', borderRadius: 16, padding: '8px 16px', fontWeight: 700, fontSize: 28 }}>Kamu di sini, di depot</div>
          </Pop>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 30 }}>
        <Pop at={202}>
          <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 28, padding: 26 }}>
            <div style={{ fontSize: 38, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ width: 26, height: 26, borderRadius: 13, background: C.success, border: '5px solid white' }} /> Tepat
            </div>
            <div style={{ fontSize: 27, opacity: 0.85, marginTop: 6, lineHeight: 1.3 }}>Titik asli, selisih beberapa meter</div>
          </div>
        </Pop>
        <Pop at={230}>
          <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 28, padding: 26 }}>
            <div style={{ fontSize: 38, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ width: 26, height: 26, borderRadius: 13, background: C.amber, border: '5px solid white' }} /> Perkiraan
            </div>
            <div style={{ fontSize: 27, opacity: 0.85, marginTop: 6, lineHeight: 1.3 }}>Dibulatkan ke kotak ±2 km, bisa meleset jauh</div>
          </div>
        </Pop>
      </div>
    </div>
  );
};
Object.assign(Why, { bare: true });

const BoardCard: React.FC<{ at: number; n: string; icon: Icon; title: string; sub: string; tone?: string }> = ({
  at,
  n,
  icon: I,
  title,
  sub,
  tone = '#5fd49a',
}) => {
  const frame = useCurrentFrame();
  const checked = frame >= at + 40;
  return (
    <Pop at={at}>
      <div style={{ display: 'flex', gap: 30, alignItems: 'center', background: 'rgba(255,255,255,0.12)', borderRadius: 36, padding: '38px 34px' }}>
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: 34,
            background: checked ? tone : 'rgba(255,255,255,0.16)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            position: 'relative',
          }}
        >
          <I size={66} weight="fill" color={checked ? C.brand900 : 'white'} />
          <div
            style={{
              position: 'absolute',
              top: -12,
              left: -12,
              width: 44,
              height: 44,
              borderRadius: 22,
              background: 'white',
              color: C.brand900,
              fontWeight: 800,
              fontSize: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {n}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.15 }}>{title}</div>
          <div style={{ fontSize: 31, opacity: 0.85, marginTop: 10, lineHeight: 1.35 }}>{sub}</div>
        </div>
      </div>
    </Pop>
  );
};

const LocationChecklist: React.FC = () => (
  <div style={{ display: 'grid', gap: 34 }}>
    <BoardCard at={118} n="1" icon={MapPinArea} title='Lokasi akurat nyala' sub='Setelan → Aplikasi → Hydromart Ops → Izin → Lokasi → "Gunakan lokasi akurat"' />
    <BoardCard at={194} n="2" icon={NavigationArrow} title="GPS / Lokasi HP nyala" sub="Usap layar dari atas → ikon Lokasi" />
    <BoardCard at={234} n="3" icon={Hourglass} title="Tunggu sebentar" sub="Geser ke dekat pintu atau ke luar ruangan biar sinyal GPS lebih kuat" />
    <BoardCard at={416} n="4" icon={ArrowsClockwise} title="Aplikasi versi terbaru" sub="Play Store → Hydromart Ops → Perbarui" />
    <Pop at={540}>
      <div style={{ textAlign: 'center', fontSize: 36, fontWeight: 700, opacity: 0.9, marginTop: 14 }}>
        Sudah semua tapi masih gagal? Hubungi kepala depot.
      </div>
    </Pop>
  </div>
);
Object.assign(LocationChecklist, { bare: true });

const ErrorRow: React.FC<{ at: number; icon: Icon; msg: string; fix: string }> = ({ at, icon: I, msg, fix }) => (
  <Pop at={at}>
    <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 36, padding: '32px 32px' }}>
      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', background: '#fdeceb', color: C.danger, borderRadius: 22, padding: '20px 24px', fontSize: 32, fontWeight: 700, lineHeight: 1.3 }}>
        <I size={42} weight="fill" style={{ flexShrink: 0 }} /> {msg}
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 36, fontWeight: 700, marginTop: 20, lineHeight: 1.3 }}>
        <CheckCircle size={44} weight="fill" color="#5fd49a" style={{ flexShrink: 0 }} /> {fix}
      </div>
    </div>
  </Pop>
);

const FaceErrors: React.FC = () => (
  <div style={{ display: 'grid', gap: 30 }}>
    <ErrorRow at={128} icon={ImageSquare} msg="Foto terlalu gelap atau kamera tertutup." fix="Cari tempat lebih terang, wajah terlihat jelas" />
    <ErrorRow at={224} icon={SmileySad} msg="Wajah tidak cocok" fix="Ulangi foto, atau Daftar / Perbarui Wajah" />
    <ErrorRow at={360} icon={UserFocus} msg="Wajah belum di-enroll" fix="Daftarkan wajah dulu" />
    <ErrorRow at={456} icon={CloudSlash} msg="Tidak ada sinyal. Absen disimpan di perangkat dan dikirim otomatis nanti." fix="Santai, absennya terkirim sendiri" />
  </div>
);
Object.assign(FaceErrors, { bare: true });

// ── phone scenes ──────────────────────────────────────────────────────────────
const Signs: React.FC = () => (
  <ShiftScreen
    verified={false}
    notice
    noticeSpot={{ at: 160, until: 290, text: 'Peringatan kuning = lokasi masih "Perkiraan"' }}
    tapAt={330}
    errorAt={345}
    errorSpot={{ at: 455, text: 'Ditolak, plus cara memperbaikinya' }}
  />
);

const LocationDialog: React.FC<{ at: number; until?: number; pick?: 'Tepat' | 'Perkiraan'; tapTepat?: number; tapUse?: number; spotPerkiraan?: number }> = ({
  at,
  until = 1e9,
  pick = 'Tepat',
  tapTepat,
  tapUse,
  spotPerkiraan,
}) => {
  const frame = useCurrentFrame();
  const p = ease(frame, at, 10) * (1 - ease(frame, until, 10));
  if (p === 0) return null;
  const tile = (label: 'Tepat' | 'Perkiraan') => {
    const on = pick === label;
    const art = (
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            width: 104,
            height: 104,
            borderRadius: 52,
            margin: '0 auto',
            background: '#dfe8e2',
            border: `4px solid ${on ? A.blue : 'transparent'}`,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <svg viewBox="0 0 100 100" width="100%" height="100%">
            <path d="M0 35 H100 M0 70 H100 M30 0 V100 M70 0 V100" stroke="white" strokeWidth="7" />
            {label === 'Tepat' ? (
              <path d="M50 26 C40 26 34 33 34 41 C34 52 50 66 50 66 C50 66 66 52 66 41 C66 33 60 26 50 26Z" fill={A.blue} />
            ) : (
              <circle cx="50" cy="50" r="30" fill="rgba(58,91,217,0.35)" stroke={A.blue} strokeWidth="2" />
            )}
          </svg>
        </div>
        <div style={{ marginTop: 8, fontSize: 15, fontWeight: 600, color: on ? A.blue : A.text }}>{label}</div>
      </div>
    );
    let el: React.ReactNode = art;
    if (label === 'Tepat' && tapTepat !== undefined) el = <Tapped at={tapTepat}>{art}</Tapped>;
    if (label === 'Perkiraan' && spotPerkiraan !== undefined)
      el = (
        <Spot at={spotPerkiraan} until={spotPerkiraan + 75} text="Jangan pilih ini" place="below" align="right">
          {art}
        </Spot>
      );
    return <div style={{ flex: 1 }}>{el}</div>;
  };
  const btn = (label: string, tap?: number) => {
    const b = (
      <div style={{ background: A.blueBg, color: A.blue, borderRadius: 22, padding: '12px 0', textAlign: 'center', fontSize: 15.5, fontWeight: 600 }}>
        {label}
      </div>
    );
    return tap !== undefined ? <Tapped at={tap}>{b}</Tapped> : <div>{b}</div>;
  };
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: `rgba(0,0,0,${0.45 * p})`, zIndex: 30 }} />
      <div
        style={{
          position: 'absolute',
          left: 18,
          right: 18,
          bottom: 30,
          zIndex: 31,
          background: '#f7f7fc',
          borderRadius: 30,
          padding: '22px 20px',
          opacity: p,
          transform: `translateY(${(1 - p) * 40}px)`,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <MapPin size={28} color={A.blue} weight="fill" />
        </div>
        <div style={{ textAlign: 'center', fontSize: 18.5, color: A.text, marginTop: 8, lineHeight: 1.35 }}>
          Izinkan <b>Hydromart Ops</b> mengakses lokasi perangkat ini?
        </div>
        <div style={{ display: 'flex', gap: 10, margin: '18px 0' }}>
          {tile('Tepat')}
          {tile('Perkiraan')}
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {btn('Saat aplikasi digunakan', tapUse)}
          {btn('Hanya kali ini')}
          {btn('Jangan izinkan')}
        </div>
      </div>
    </>
  );
};

const Dialog: React.FC = () => {
  const frame = useCurrentFrame();
  const warn = ease(frame, 327, 14);
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <ShiftScreen verified={false} />
      <LocationDialog at={20} until={210} tapTepat={136} tapUse={190} />
      <LocationDialog at={248} until={322} pick="Tepat" spotPerkiraan={256} />
      {warn > 0 && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 40, background: `rgba(22,40,46,${0.55 * warn})`, display: 'flex', alignItems: 'center', padding: 20 }}>
          <div
            style={{
              background: C.amber,
              color: '#1f1400',
              borderRadius: 26,
              padding: 22,
              opacity: warn,
              transform: `scale(${0.9 + warn * 0.1})`,
              fontFamily: FONT,
            }}
          >
            <div style={{ fontSize: 46, fontWeight: 800, lineHeight: 1 }}>2×</div>
            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 8 }}>Sudah dua kali pilih "Perkiraan"?</div>
            <div style={{ fontSize: 15.5, fontWeight: 600, marginTop: 8, lineHeight: 1.4 }}>
              Android tidak akan bertanya lagi. Ubahnya harus lewat Setelan HP — lihat langkah berikutnya.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SettingsHome: React.FC<{ tapAt: number }> = ({ tapAt }) => (
  <AndroidScreen>
    <AndroidBar title="Setelan" big />
    <div style={{ margin: '0 18px 10px', background: '#e5e7f2', borderRadius: 26, padding: '12px 16px', display: 'flex', gap: 10, color: A.muted, fontSize: 15, fontFamily: 'system-ui, sans-serif' }}>
      <MagnifyingGlass size={18} /> Telusuri setelan
    </div>
    <ARow icon={WifiHigh} color="#3a5bd9" title="Jaringan & internet" sub="Wi-Fi, seluler" />
    <ARow icon={Bluetooth} color="#2c8a8a" title="Perangkat terhubung" sub="Bluetooth" />
    <Tapped at={tapAt}>
      <ARow icon={Gear} color="#c2410c" title="Aplikasi" sub="Aplikasi terbaru, aplikasi default" />
    </Tapped>
    <ARow icon={Bell} color="#7c3aed" title="Notifikasi" sub="Riwayat notifikasi, percakapan" />
    <ARow icon={BatteryFull} color="#15803d" title="Baterai" sub="82%" />
    <ARow icon={MapPin} color="#0e7490" title="Lokasi" sub="Aktif" />
    <ARow icon={ShieldCheck} color="#475569" title="Keamanan & privasi" />
  </AndroidScreen>
);

const AppsList: React.FC<{ spotAt: number; tapAt: number }> = ({ spotAt, tapAt }) => (
  <AndroidScreen>
    <AndroidBar title="Semua aplikasi" />
    <ARow icon={Camera} color="#64748b" title="Kamera" />
    <ARow icon={ImageSquare} color="#db2777" title="Galeri" />
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '13px 20px', fontFamily: 'system-ui, sans-serif' }}>
      <AppIcon size={36} ops={false} />
      <div style={{ fontSize: 16.5, color: A.text }}>Hydromart</div>
    </div>
    <Spot at={spotAt} until={tapAt + 6} text='Pilih "Hydromart Ops", bukan "Hydromart"'>
      <Tapped at={tapAt}>
        <ARow app title="Hydromart Ops" sub="Versi 1.16.3" />
      </Tapped>
    </Spot>
    <ARow icon={Bell} color="#0891b2" title="Jam" />
    <ARow icon={PhoneIcon} color="#16a34a" title="Telepon" />
  </AndroidScreen>
);

const AppInfo: React.FC<{ tapIzin?: number; label?: string }> = ({ tapIzin, label }) => (
  <AndroidScreen>
    <AndroidBar title="Info aplikasi" />
    <div style={{ textAlign: 'center', padding: '8px 0 14px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'inline-block' }}>
        <AppIcon size={70} />
      </div>
      <div style={{ fontSize: 22, color: A.text, marginTop: 10 }}>Hydromart Ops</div>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: '0 18px 12px', fontFamily: 'system-ui, sans-serif' }}>
      {['Buka', 'Uninstal', 'Paksa berhenti'].map((b) => (
        <div key={b} style={{ textAlign: 'center', fontSize: 13, color: A.blue, background: A.blueBg, borderRadius: 16, padding: '10px 0' }}>
          {b}
        </div>
      ))}
    </div>
    <ARow title="Notifikasi" sub="Aktif" />
    {tapIzin !== undefined ? (
      <Spot at={tapIzin - 40} until={tapIzin + 6} text="Ketuk Izin" align="right">
        <Tapped at={tapIzin}>
          <ARow title="Izin" sub="Kamera dan Lokasi" />
        </Tapped>
      </Spot>
    ) : (
      <ARow title="Izin" sub="Kamera dan Lokasi" />
    )}
    <ARow title="Penyimpanan & cache" />
    <ARow title="Baterai" />
    <ARow title="Buka secara default" />
    {label && (
      <div style={{ position: 'absolute', top: 12, right: 12, background: C.amber, color: '#1f1400', fontWeight: 800, fontSize: 13, borderRadius: 10, padding: '6px 10px' }}>
        {label}
      </div>
    )}
  </AndroidScreen>
);

const HomeScreen: React.FC<{ pressAt: number; menuAt: number; tapInfo: number }> = ({ pressAt, menuAt, tapInfo }) => {
  const frame = useCurrentFrame();
  const icons: { label: string; node: React.ReactNode }[] = [
    { label: 'Hydromart Ops', node: <AppIcon size={56} /> },
    { label: 'Hydromart', node: <AppIcon size={56} ops={false} /> },
    { label: 'Kamera', node: <Circle I={Camera} color="#64748b" /> },
    { label: 'Galeri', node: <Circle I={ImageSquare} color="#db2777" /> },
    { label: 'Setelan', node: <Circle I={Gear} color="#475569" /> },
    { label: 'Play Store', node: <Circle I={Storefront} color="#16a34a" /> },
  ];
  const menu = ease(frame, menuAt, 10);
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(170deg, #20476b 0%, #0f2f3c 100%)', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ color: 'white', textAlign: 'center', fontSize: 56, fontWeight: 300, marginTop: 60 }}>07.30</div>
      <div style={{ color: 'rgba(255,255,255,0.8)', textAlign: 'center', fontSize: 15 }}>Rabu, 25 November</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', rowGap: 22, padding: '70px 14px 0' }}>
        {icons.map((ic, i) => (
          <div key={ic.label} style={{ textAlign: 'center', position: 'relative', zIndex: i === 0 ? 5 : 1 }}>
            <div style={{ display: 'inline-block', position: 'relative', transform: i === 0 && frame >= pressAt + 10 && frame < menuAt + 200 ? 'scale(1.08)' : undefined }}>
              {ic.node}
              {i === 0 && <LongPress at={pressAt} hold={34} />}
            </div>
            <div style={{ color: 'white', fontSize: 12.5, marginTop: 6 }}>{ic.label}</div>
            {i === 0 && menu > 0 && (
              <div
                style={{
                  position: 'absolute',
                  left: 8,
                  top: 92,
                  width: 200,
                  background: 'white',
                  borderRadius: 20,
                  padding: 6,
                  opacity: menu,
                  transform: `scale(${0.9 + menu * 0.1})`,
                  transformOrigin: 'top left',
                  boxShadow: '0 12px 30px rgba(0,0,0,0.35)',
                  textAlign: 'left',
                }}
              >
                <Spot at={menuAt + 30} until={tapInfo + 6} text='Ketuk "Info aplikasi"' align="left">
                  <Tapped at={tapInfo}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 12px', fontSize: 15.5, color: A.text, background: 'white', borderRadius: 14 }}>
                      <Info size={20} /> Info aplikasi
                    </div>
                  </Tapped>
                </Spot>
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 16, right: 16, top: 14, background: C.amber, color: '#1f1400', fontWeight: 800, fontSize: 14, borderRadius: 12, padding: '8px 12px', textAlign: 'center', fontFamily: FONT }}>
        Cara cepat: tekan lama ikon Hydromart Ops
      </div>
    </div>
  );
};

const Circle: React.FC<{ I: Icon; color: string }> = ({ I, color }) => (
  <div style={{ width: 56, height: 56, borderRadius: 18, background: color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
    <I size={28} color="white" weight="fill" />
  </div>
);

const Settings: React.FC = () => (
  <Screens at={[0, 140, 215, 245, 425]}>
    {[
      <SettingsHome key="s" tapAt={128} />,
      <AppsList key="l" spotAt={165} tapAt={200} />,
      <AppInfo key="i" />,
      <HomeScreen key="h" pressAt={273} menuAt={310} tapInfo={410} />,
      <AppInfo key="j" tapIzin={482} />,
    ]}
  </Screens>
);

const PermsList: React.FC<{ tapAt: number }> = ({ tapAt }) => (
  <AndroidScreen>
    <AndroidBar title="Izin aplikasi" />
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '0 20px 14px', fontFamily: 'system-ui, sans-serif' }}>
      <AppIcon size={34} />
      <div style={{ fontSize: 17, color: A.text }}>Hydromart Ops</div>
    </div>
    <div style={{ padding: '10px 20px 4px', fontSize: 13, color: A.blue, fontWeight: 600, fontFamily: 'system-ui, sans-serif' }}>Diizinkan</div>
    <ARow icon={Camera} color="#64748b" title="Kamera" />
    <Tapped at={tapAt}>
      <ARow icon={MapPin} color="#0e7490" title="Lokasi" />
    </Tapped>
    <ARow icon={Bell} color="#7c3aed" title="Notifikasi" />
  </AndroidScreen>
);

const LocationPerm: React.FC<{ whileUseAt: number; toggleAt: number; spotAt: number; doneAt: number }> = ({
  whileUseAt,
  toggleAt,
  spotAt,
  doneAt,
}) => {
  const frame = useCurrentFrame();
  const done = ease(frame, doneAt, 12);
  return (
    <AndroidScreen>
      <AndroidBar title="Izin lokasi" />
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '0 20px 10px', fontFamily: 'system-ui, sans-serif' }}>
        <AppIcon size={34} />
        <div style={{ fontSize: 17, color: A.text }}>Hydromart Ops</div>
      </div>
      <div style={{ padding: '10px 20px 4px', fontSize: 13, color: A.blue, fontWeight: 600, fontFamily: 'system-ui, sans-serif' }}>
        Akses lokasi untuk aplikasi ini
      </div>
      <Tapped at={whileUseAt}>
        <Radio on label="Izinkan hanya saat aplikasi digunakan" />
      </Tapped>
      <Radio on={false} label="Tanyakan setiap waktu" />
      <Radio on={false} label="Jangan izinkan" />
      <div style={{ height: 1, background: A.line, margin: '8px 20px' }} />
      <Spot at={spotAt} until={doneAt - 4} text="Ini kuncinya: harus aktif">
        <Tapped at={toggleAt}>
          <ARow title="Gunakan lokasi akurat" right={<Toggle on={ease(frame, toggleAt + 2, 8)} />} />
        </Tapped>
      </Spot>
      {done > 0 && (
        <div style={{ position: 'absolute', left: 20, right: 20, bottom: 40, opacity: done, transform: `translateY(${(1 - done) * 20}px)` }}>
          <div style={{ background: C.success, color: 'white', borderRadius: 18, padding: '14px 16px', display: 'flex', gap: 10, alignItems: 'center', fontFamily: FONT, fontWeight: 800, fontSize: 17 }}>
            <CheckCircle size={26} weight="fill" /> Lokasi sekarang: Tepat
          </div>
        </div>
      )}
    </AndroidScreen>
  );
};

const Precise: React.FC = () => (
  <Screens at={[0, 58]}>
    {[<PermsList key="p" tapAt={45} />, <LocationPerm key="l" whileUseAt={95} spotAt={215} toggleAt={275} doneAt={385} />]}
  </Screens>
);

const Gps: React.FC = () => {
  const frame = useCurrentFrame();
  const shade = ease(frame, 158, 16);
  const swipe = ease(frame, 128, 26);
  const on = frame >= 221;
  const tiles: [string, Icon, boolean][] = [
    ['Internet', WifiHigh, true],
    ['Bluetooth', Bluetooth, false],
    ['Lokasi', MapPin, on],
    ['Senter', Flashlight, false],
  ];
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <ShiftScreen verified={false} />
      {frame >= 120 && frame < 168 && (
        <div style={{ position: 'absolute', left: '50%', top: 20 + swipe * 260, width: 40, height: 40, marginLeft: -20, borderRadius: 20, background: 'rgba(22,40,46,0.35)', border: '2px solid white', zIndex: 50 }} />
      )}
      {shade > 0 && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            background: '#1f2125',
            transform: `translateY(${(shade - 1) * 100}%)`,
            zIndex: 30,
            padding: '20px 16px',
            fontFamily: 'system-ui, sans-serif',
            color: 'white',
          }}
        >
          <div style={{ fontSize: 34, fontWeight: 300 }}>07.31</div>
          <div style={{ fontSize: 14, opacity: 0.75, marginBottom: 18 }}>Rab, 25 Nov</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {tiles.map(([label, I, active]) => {
              const tile = (
                <div
                  style={{
                    background: active ? '#a9c0ff' : '#33363c',
                    color: active ? '#0b1a4a' : 'white',
                    borderRadius: 24,
                    padding: '16px 14px',
                    display: 'flex',
                    gap: 10,
                    alignItems: 'center',
                    fontSize: 15.5,
                    fontWeight: 600,
                  }}
                >
                  <I size={22} weight="fill" />
                  <div>
                    {label}
                    <div style={{ fontSize: 12, fontWeight: 400, opacity: 0.8 }}>{active ? 'Aktif' : 'Nonaktif'}</div>
                  </div>
                </div>
              );
              return label === 'Lokasi' ? (
                <Spot key={label} at={185} until={330} text="Nyalakan Lokasi" align="right">
                  <Tapped at={217}>{tile}</Tapped>
                </Spot>
              ) : (
                <div key={label}>{tile}</div>
              );
            })}
          </div>
        </div>
      )}
      {frame >= 314 && (
        <div style={{ position: 'absolute', left: 16, right: 16, bottom: 30, zIndex: 45 }}>
          <Spot at={316} text="Tunggu beberapa detik, terutama di dalam ruangan" place="above">
            <Card style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Hourglass size={28} weight="fill" color={C.brand700} />
              <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35 }}>GPS baru menyala butuh waktu untuk menemukan lokasimu.</div>
            </Card>
          </Spot>
        </div>
      )}
    </div>
  );
};

const Back: React.FC = () => (
  <FaceCheck
    depot={DEPOT}
    mode="Check-in"
    shootAt={1e9}
    doneAt={1e9}
    result=""
    hint={HINT_V163}
    above={
      <Spot at={45} until={205} text="Masih ada? Berarti masih Perkiraan" place="below">
        <PreciseNotice />
      </Spot>
    }
    aboveUntil={215}
    spot={{ on: 'toggle', at: 232, text: 'Peringatan hilang = lokasi sudah Tepat ✓' }}
  />
);

const Enroll: React.FC = () => (
  <Screens at={[0, 150]}>
    {[
      <HrHome key="h" name={NAME} tap="enroll" tapAt={135} />,
      <EnrollScreen key="e" shots={[290, 306, 322]} consentAt={342} saveAt={400} spot={{ at: 236, until: 284, text: 'Cari tempat yang terang' }} />,
    ]}
  </Screens>
);

const CheckIn: React.FC = () => (
  <Screens at={[0, 75]}>
    {[
      <HrHome key="h" name={NAME} tap="absen" tapAt={60} />,
      <FaceCheck
        key="f"
        depot={DEPOT}
        mode="Check-in"
        shootAt={225}
        doneAt={312}
        result="Masuk 07.28"
        hint={HINT_V163}
        spot={[
          { on: 'hint', at: 128, until: 218, text: 'Tatap kamera & tahan sebentar', place: 'above' },
          { on: 'camera', at: 238, until: 308, text: 'Tidak perlu geleng atau kedip lagi', place: 'below' },
          { on: 'result', at: 378, text: 'Check-in berhasil = absen tercatat' },
        ]}
      />,
    ]}
  </Screens>
);

const Shift: React.FC = () => (
  <Screens at={[0, 345]}>
    {[
      <ShiftScreen key="s" verified checkSpot={{ at: 200, until: 318, text: 'Jarak ke depot diperiksa di sini' }} tapAt={330} />,
      <DriverHome key="d" />,
    ]}
  </Screens>
);

const CheckOut: React.FC = () => (
  <Screens at={[0, 125]}>
    {[
      <HrHome key="h" name={NAME} tap="absen" tapAt={110} />,
      <FaceCheck
        key="f"
        depot={DEPOT}
        mode="Check-out"
        modeAt={172}
        shootAt={225}
        doneAt={268}
        result="Masuk 07.28 · Keluar 17.05"
        hint={HINT_V163}
        spot={{ on: 'result', at: 288, text: 'Kurir: akhiri shift ≠ absen pulang. Lakukan dua-duanya.' }}
      />,
    ]}
  </Screens>
);

export const ABSENSI_SCREENS: Record<string, React.FC> = {
  why: Why,
  signs: Signs,
  dialog: Dialog,
  settings: Settings,
  precise: Precise,
  gps: Gps,
  back: Back,
  enroll: Enroll,
  checkin: CheckIn,
  shift: Shift,
  'location-checklist': LocationChecklist,
  'face-errors': FaceErrors,
  checkout: CheckOut,
};

export const ABSENSI_TITLE = {
  kicker: 'Panduan Absensi · Hydromart Ops',
  bullets: ['Kenapa lokasi ditolak', 'Ubah lokasi ke "Tepat"', 'Daftar & absen wajah', 'Kalau masih gagal'],
  outroBullets: ['Lokasi "Tepat" ✓', 'GPS nyala ✓', 'Wajah terdaftar ✓', 'Absen masuk & pulang ✓'],
};
