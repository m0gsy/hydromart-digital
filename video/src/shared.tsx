// Screens both roles use: sign-in and the /hr/me self-service (face attendance).
// Labels: apps/web/src/lib/dictionaries/id/auth.ts and hrFix.ts. Names and numbers are sample data.
import React from 'react';
import { useCurrentFrame } from 'remotion';
import { ArrowLeft, Camera, CheckCircle } from '@phosphor-icons/react';
import { Btn, C, Card, Chip, ease, Field, PageHead, Spot, Tapped, Toast, typed } from './ui';

export const PHONE_NUMBER = '812 3456 7890';

export const LoginScreen: React.FC<{ typeFrom: number; tapAt: number }> = ({ typeFrom, tapAt }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ padding: '40px 22px' }}>
      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5 }}>Selamat datang kembali</div>
      <div style={{ fontSize: 14, color: C.textMuted, marginTop: 8, lineHeight: 1.4 }}>
        Masuk dengan nomor teleponmu — kami kirim kode sekali pakai.
      </div>
      <div style={{ marginTop: 32 }}>
        <Field
          label="Nomor telepon"
          prefix="🇮🇩 +62"
          placeholder="81234567890"
          value={typed(frame, PHONE_NUMBER, typeFrom, 2)}
          focus={frame >= typeFrom - 6 && frame < tapAt}
        />
      </div>
      <Tapped at={tapAt} style={{ marginTop: 10 }}>
        <Btn style={{ padding: 14 }}>Kirim kode</Btn>
      </Tapped>
    </div>
  );
};

export const VerifyScreen: React.FC<{ typeFrom: number; tapAt: number; hintAt?: number }> = ({
  typeFrom,
  tapAt,
  hintAt = 1e9,
}) => {
  const frame = useCurrentFrame();
  const code = typed(frame, '482913', typeFrom, 5);
  return (
    <div style={{ padding: '24px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.brand700, fontSize: 13, fontWeight: 700 }}>
        <ArrowLeft size={14} weight="bold" /> Kembali ke masuk
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, marginTop: 18 }}>Verifikasi nomormu</div>
      <div style={{ fontSize: 14, color: C.textMuted, marginTop: 8, lineHeight: 1.4 }}>
        Masuk ke akunmu. Masukkan kode yang kami kirim ke <b style={{ color: C.text }}>+62 {PHONE_NUMBER}</b>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 28 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 54,
              borderRadius: 12,
              background: C.surface,
              border: `1.5px solid ${i === code.length && frame < tapAt ? C.brand600 : C.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 24,
              fontWeight: 800,
            }}
          >
            {code[i] ?? ''}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 13, color: C.textMuted, marginTop: 12 }}>Kode berlaku 04:52 lagi.</div>
      <Spot at={hintAt} text="Berikutnya cukup Buka sesi tersimpan dengan sidik jari / PIN" style={{ marginTop: 22 }}>
        <Tapped at={tapAt}>
          <Btn style={{ padding: 14 }}>Verifikasi &amp; lanjut</Btn>
        </Tapped>
      </Spot>
      <div style={{ fontSize: 13, color: C.textMuted, marginTop: 16, textAlign: 'center' }}>
        Tidak menerima kode? <span style={{ color: C.brand700, fontWeight: 700 }}>Kirim ulang dalam 41d</span>
      </div>
    </div>
  );
};

export type HrCard = 'absen' | 'slip' | 'cuti' | 'kasbon' | 'pengumuman' | 'enroll';

/**
 * /hr/me — "Layanan mandiri karyawan". `tap` puts a finger on one card at `tapAt`; `spots` outlines
 * cards one after another, each with its label.
 */
export const HrHome: React.FC<{
  name: string;
  tap?: HrCard;
  tapAt?: number;
  spots?: { card: HrCard; at: number; until: number; text: string }[];
}> = ({ name, tap, tapAt = -99, spots = [] }) => {
  const wrap = (id: HrCard, node: React.ReactNode) => {
    const s = spots.find((x) => x.card === id);
    const inner = id === tap ? <Tapped at={tapAt}>{node}</Tapped> : node;
    return s ? (
      <Spot at={s.at} until={s.until} text={s.text} place={id === 'enroll' || id === 'pengumuman' ? 'above' : 'below'}>
        {inner}
      </Spot>
    ) : (
      inner
    );
  };
  const tile = (title: string, sub?: string, accent?: boolean, h = 64) => (
    <Card
      style={{ textAlign: 'center', height: h, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 10 }}
    >
      <div style={{ fontSize: accent ? 19 : 16, fontWeight: 800, color: accent ? C.brand700 : C.text }}>{title}</div>
      {sub && <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 4 }}>{sub}</div>}
    </Card>
  );
  return (
    <div style={{ padding: '18px 20px' }}>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.5 }}>Halo, {name}</div>
      <div style={{ fontSize: 14, color: C.textMuted, marginTop: 4 }}>Layanan mandiri karyawan</div>
      <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
        {wrap('absen', tile('Absen Sekarang', 'Check-in / check-out dengan verifikasi wajah', true, 84))}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {tile('Absensi Saya')}
          {wrap('slip', tile('Slip Gaji Saya'))}
        </div>
        {wrap('cuti', tile('Cuti Saya', 'Ajukan cuti & lihat sisa kuota'))}
        {wrap('kasbon', tile('Kasbon Saya'))}
        {wrap('pengumuman', tile('Pengumuman', 'Kabar dari HR untuk Anda'))}
        {wrap(
          'enroll',
          <Card style={{ textAlign: 'center', padding: 14, color: C.brand700, fontWeight: 700, fontSize: 15 }}>
            Daftar / Perbarui Wajah
          </Card>,
        )}
      </div>
    </div>
  );
};

/** A front camera preview: a person in a face guide, blinking and turning slightly. */
export const CameraView: React.FC<{ scanAt?: number; height?: number }> = ({ scanAt = 1e9, height = 300 }) => {
  const frame = useCurrentFrame();
  const turn = Math.sin(frame / 18) * 6;
  const blink = frame % 70 > 64 ? 0.15 : 1;
  const scan = ease(frame, scanAt, 24);
  const flash = frame >= scanAt && frame < scanAt + 5 ? 0.8 : 0;
  return (
    <div
      style={{
        position: 'relative',
        height,
        borderRadius: 20,
        overflow: 'hidden',
        background: 'linear-gradient(180deg, #3d4f55 0%, #1f2b2e 100%)',
      }}
    >
      <svg viewBox="0 0 350 300" width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        <g transform={`translate(${175 + turn} 0)`}>
          <ellipse cx={0} cy={330} rx={120} ry={90} fill="#2f6f79" />
          <rect x={-22} y={190} width={44} height={50} rx={14} fill="#d9a47f" />
          <ellipse cx={0} cy={145} rx={60} ry={72} fill="#e8b892" />
          <path d="M-62 130 Q-60 62 0 62 Q60 62 62 130 Q50 92 0 90 Q-50 92 -62 130Z" fill="#2a1d17" />
          <ellipse cx={-22} cy={146} rx={6} ry={6 * blink} fill="#2a1d17" />
          <ellipse cx={22} cy={146} rx={6} ry={6 * blink} fill="#2a1d17" />
          <path d="M-14 182 Q0 192 14 182" stroke="#9c5b45" strokeWidth={4} fill="none" strokeLinecap="round" />
        </g>
        <ellipse
          cx={175}
          cy={150}
          rx={92}
          ry={118}
          fill="none"
          stroke={scan > 0 && scan < 1 ? C.brand600 : 'rgba(255,255,255,0.85)'}
          strokeWidth={3}
          strokeDasharray="10 8"
        />
      </svg>
      {scan > 0 && scan < 1 && (
        <div
          style={{
            position: 'absolute',
            left: 70,
            right: 70,
            top: 30 + scan * (height - 70),
            height: 3,
            background: C.brand600,
            boxShadow: `0 0 16px ${C.brand600}`,
          }}
        />
      )}
      <div style={{ position: 'absolute', inset: 0, background: 'white', opacity: flash }} />
    </div>
  );
};

/** /hr/me/check-in — "Absensi Wajah". `mode` flips to Check-out at `modeAt`. */
export const FaceCheck: React.FC<{
  depot: string;
  mode: 'Check-in' | 'Check-out';
  modeAt?: number;
  shootAt: number;
  doneAt: number;
  result: string;
  spot?: { at: number; text: string; on: 'toggle' | 'result' };
}> = ({ depot, mode, modeAt = -99, shootAt, doneAt, result, spot }) => {
  const frame = useCurrentFrame();
  const active = mode === 'Check-out' && frame < modeAt + 4 ? 'Check-in' : mode;
  const done = frame >= doneAt;
  const toggle = (
    <div style={{ display: 'flex', background: C.soft, borderRadius: 14, padding: 4 }}>
      {(['Check-in', 'Check-out'] as const).map((m) => {
        const pill = (
          <div
            style={{
              textAlign: 'center',
              padding: '9px 0',
              borderRadius: 11,
              fontSize: 14,
              fontWeight: 700,
              background: active === m ? C.surface : 'transparent',
              color: active === m ? C.brand700 : C.textMuted,
              boxShadow: active === m ? '0 1px 3px rgba(22,40,46,0.1)' : undefined,
            }}
          >
            {m}
          </div>
        );
        return (
          <div key={m} style={{ flex: 1 }}>
            {m === 'Check-out' && modeAt > 0 ? <Tapped at={modeAt}>{pill}</Tapped> : pill}
          </div>
        );
      })}
    </div>
  );
  const resultCard = (
    <Card style={{ textAlign: 'center', padding: 24 }}>
      <div style={{ transform: `scale(${0.6 + ease(frame, doneAt, 10) * 0.4})` }}>
        <CheckCircle size={64} weight="fill" color={C.success} />
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 8 }}>{mode} berhasil</div>
      <div style={{ marginTop: 10 }}>
        <Chip tone="success">Hadir</Chip>
      </div>
      <div style={{ fontSize: 13.5, color: C.textMuted, marginTop: 12 }}>{result}</div>
    </Card>
  );
  return (
    <div>
      <PageHead title="Absensi Wajah" sub={`Hari ini: depot ${depot}`} />
      <div style={{ padding: '0 20px' }}>
        {spot?.on === 'toggle' ? (
          <Spot at={spot.at} text={spot.text}>
            {toggle}
          </Spot>
        ) : (
          toggle
        )}
        <div style={{ height: 12 }} />
        {done ? (
          spot?.on === 'result' ? (
            <Spot at={spot.at} text={spot.text}>
              {resultCard}
            </Spot>
          ) : (
            resultCard
          )
        ) : (
          <>
            <CameraView scanAt={shootAt} height={300} />
            <div style={{ fontSize: 12.5, color: C.textMuted, margin: '10px 4px', textAlign: 'center', lineHeight: 1.4 }}>
              Gerakkan kepala sedikit / kedipkan mata saat mengambil foto.
            </div>
            <Tapped at={shootAt}>
              <Btn style={{ padding: 14 }}>
                <Camera size={18} weight="bold" /> Ambil Foto
              </Btn>
            </Tapped>
          </>
        )}
      </div>
      <Toast at={doneAt}>{mode} berhasil</Toast>
    </div>
  );
};
