// Shared look for both tutorials: the Hydromart "Fresh Flow" tokens (apps/web/src/app/globals.css),
// a phone frame, the replica UI pieces the scenes are built from, and the motion helpers.
import React from 'react';
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  Easing,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { BatteryFull, CellSignalFull, WifiHigh } from '@phosphor-icons/react';

export const C = {
  brand50: '#e4f5f7',
  brand100: '#d3edf1',
  brand600: '#0c97ac',
  brand700: '#0a7f92',
  brand800: '#0b4d57',
  brand900: '#0b3b43',
  surface: '#ffffff',
  muted: '#faf9f5',
  soft: '#f0eee6',
  border: '#e9e7df',
  text: '#16282e',
  textMuted: '#64757c',
  success: '#18734a',
  successBg: '#e2f5e9',
  warning: '#b97d10',
  warningBg: '#faf1de',
  danger: '#b3261e',
  dangerBg: '#fdeceb',
  amber: '#d09415',
};

export const FONT = "'Jakarta', system-ui, sans-serif";

// ── font ──────────────────────────────────────────────────────────────────────
const fontHandle = typeof window !== 'undefined' ? delayRender('Plus Jakarta Sans') : null;
if (typeof window !== 'undefined') {
  new FontFace('Jakarta', `url(${staticFile('PlusJakartaSans-latin.woff2')}) format('woff2')`, {
    weight: '200 800',
  })
    .load()
    .then((f) => {
      document.fonts.add(f);
      if (fontHandle !== null) continueRender(fontHandle);
    });
}

// ── motion helpers ────────────────────────────────────────────────────────────
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** 0→1 over `dur` frames starting at `from`, eased. */
export const ease = (frame: number, from: number, dur = 12) =>
  interpolate(frame, [from, from + dur], [0, 1], { ...clamp, easing: Easing.bezier(0.2, 0.7, 0.2, 1) });

export const useSpring = (from: number, damping = 14) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - from, fps, config: { damping } });
};

/** Fade + rise in at `from`. */
export const Appear: React.FC<{ at?: number; y?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  at = 0,
  y = 24,
  children,
  style,
}) => {
  const p = ease(useCurrentFrame(), at, 14);
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * y}px)`, ...style }}>{children}</div>;
};

/** Counts from 0 to `to` between `from` and `from+dur`. */
export const useCount = (to: number, from: number, dur = 24) =>
  Math.round(to * ease(useCurrentFrame(), from, dur));

export const rupiah = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

// ── stage: background, step header, phone ─────────────────────────────────────
export const PHONE_W = 390;
export const PHONE_H = 780;
const SCALE = 1.75;

const Background: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, ${C.brand800} 0%, ${C.brand900} 70%)` }}>
      <div
        style={{
          position: 'absolute',
          width: 900,
          height: 900,
          borderRadius: '50%',
          left: -380 + Math.sin(frame / 60) * 30,
          top: 900 + Math.cos(frame / 70) * 30,
          background: 'radial-gradient(circle, rgba(27,162,181,0.35), transparent 65%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 700,
          height: 700,
          borderRadius: '50%',
          right: -300 + Math.cos(frame / 50) * 25,
          top: -200 + Math.sin(frame / 65) * 25,
          background: 'radial-gradient(circle, rgba(127,204,215,0.25), transparent 65%)',
        }}
      />
    </AbsoluteFill>
  );
};

export const StepHeader: React.FC<{ step: string; title: string; caption: string }> = ({ step, title, caption }) => {
  const p = useSpring(0, 16);
  const q = ease(useCurrentFrame(), 8, 16);
  return (
    <div style={{ position: 'absolute', top: 96, left: 72, right: 72, fontFamily: FONT, color: 'white' }}>
      <div
        style={{
          display: 'inline-block',
          padding: '10px 24px',
          borderRadius: 999,
          background: 'rgba(255,255,255,0.14)',
          fontSize: 30,
          fontWeight: 700,
          letterSpacing: 1,
          opacity: p,
          transform: `translateX(${(1 - p) * -40}px)`,
        }}
      >
        {step}
      </div>
      <div
        style={{
          fontSize: 64,
          fontWeight: 800,
          lineHeight: 1.1,
          marginTop: 22,
          letterSpacing: -1,
          opacity: p,
          transform: `translateY(${(1 - p) * 30}px)`,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 34, fontWeight: 500, lineHeight: 1.35, marginTop: 14, opacity: q * 0.88 }}>{caption}</div>
    </div>
  );
};

const StatusBar: React.FC = () => (
  <div
    style={{
      height: 34,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 22px',
      fontSize: 14,
      fontWeight: 700,
      color: C.text,
      background: C.muted,
    }}
  >
    <span>07.30</span>
    <span style={{ display: 'flex', gap: 4 }}>
      <CellSignalFull size={15} weight="fill" />
      <WifiHigh size={15} weight="bold" />
      <BatteryFull size={17} weight="fill" />
    </span>
  </div>
);

/** The phone, screen drawn in app px (PHONE_W × PHONE_H) and scaled up. */
export const Phone: React.FC<{ children: React.ReactNode; top?: number }> = ({ children, top = 480 }) => {
  const enter = useSpring(0, 18);
  const w = PHONE_W * SCALE;
  const bezel = 16;
  return (
    <div
      style={{
        position: 'absolute',
        left: (1080 - w) / 2 - bezel,
        top: top + (1 - enter) * 160,
        opacity: enter,
        padding: bezel,
        borderRadius: 86,
        background: '#0d1517',
        boxShadow: '0 40px 90px rgba(0,0,0,0.45), inset 0 0 0 3px #2b3a3e',
      }}
    >
      <div style={{ width: w, height: PHONE_H * SCALE, borderRadius: 70, overflow: 'hidden', background: C.muted }}>
        <div
          style={{
            width: PHONE_W,
            height: PHONE_H,
            transform: `scale(${SCALE})`,
            transformOrigin: '0 0',
            fontFamily: FONT,
            color: C.text,
            position: 'relative',
          }}
        >
          <StatusBar />
          <div style={{ position: 'absolute', top: 34, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>{children}</div>
        </div>
      </div>
    </div>
  );
};

/** A tutorial scene: background, header copy, the phone with the screen inside. */
export const Stage: React.FC<{ step: string; title: string; caption: string; children: React.ReactNode }> = ({
  step,
  title,
  caption,
  children,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const out = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <Background />
      <StepHeader step={step} title={title} caption={caption} />
      <Phone>{children}</Phone>
    </AbsoluteFill>
  );
};

// ── tap indicator ─────────────────────────────────────────────────────────────
/** A finger tap at (x, y) in app px, at frame `at`. Place it inside the phone screen. */
export const Tap: React.FC<{ x?: number | string; y?: number | string; at: number }> = ({ x = '50%', y = '50%', at }) => {
  const frame = useCurrentFrame();
  if (frame < at - 10 || frame > at + 22) return null;
  const approach = ease(frame, at - 10, 10);
  const ring = ease(frame, at, 18);
  const fade = interpolate(frame, [at + 10, at + 22], [1, 0], clamp);
  return (
    <div style={{ position: 'absolute', left: x, top: y, pointerEvents: 'none', zIndex: 50 }}>
      <div
        style={{
          position: 'absolute',
          width: 34,
          height: 34,
          left: -17,
          top: -17,
          borderRadius: '50%',
          background: 'rgba(22,40,46,0.35)',
          border: '2px solid white',
          opacity: approach * fade,
          transform: `scale(${1.4 - approach * 0.4 - (frame >= at && frame < at + 4 ? 0.15 : 0)})`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 34,
          height: 34,
          left: -17,
          top: -17,
          borderRadius: '50%',
          border: `3px solid ${C.brand600}`,
          opacity: frame >= at ? (1 - ring) * fade : 0,
          transform: `scale(${1 + ring * 1.6})`,
        }}
      />
    </div>
  );
};


// ── replica UI pieces ─────────────────────────────────────────────────────────
export const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div
    style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 20,
      padding: 16,
      boxShadow: '0 1px 3px rgba(22,40,46,0.05)',
      ...style,
    }}
  >
    {children}
  </div>
);

export const Btn: React.FC<{
  children: React.ReactNode;
  variant?: 'primary' | 'outline' | 'ghost' | 'danger';
  style?: React.CSSProperties;
}> = ({ children, variant = 'primary', style }) => {
  const v = {
    primary: { background: C.brand600, color: 'white', border: `1px solid ${C.brand600}` },
    outline: { background: C.surface, color: C.brand700, border: `1px solid ${C.border}` },
    ghost: { background: 'transparent', color: C.brand700, border: '1px solid transparent' },
    danger: { background: C.surface, color: C.danger, border: `1px solid ${C.dangerBg}` },
  }[variant];
  return (
    <div
      style={{
        ...v,
        borderRadius: 14,
        padding: '12px 14px',
        fontSize: 15,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        textAlign: 'center',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const Chip: React.FC<{ children: React.ReactNode; tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' }> = ({
  children,
  tone = 'neutral',
}) => {
  const t = {
    neutral: [C.soft, C.textMuted],
    brand: [C.brand50, C.brand800],
    success: [C.successBg, C.success],
    warning: [C.warningBg, C.warning],
    danger: [C.dangerBg, C.danger],
  }[tone];
  return (
    <span
      style={{
        background: t[0],
        color: t[1],
        borderRadius: 999,
        padding: '4px 10px',
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
};

export const Label: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = C.textMuted }) => (
  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color }}>{children}</div>
);

/** A toast sliding up from the bottom of the screen at `at`. */
export const Toast: React.FC<{ at: number; children: React.ReactNode; tone?: 'success' | 'danger' }> = ({
  at,
  children,
  tone = 'success',
}) => {
  const p = ease(useCurrentFrame(), at, 10);
  if (p === 0) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: 24 + (1 - p) * -60,
        opacity: p,
        background: tone === 'success' ? C.text : C.danger,
        color: 'white',
        borderRadius: 14,
        padding: '12px 16px',
        fontSize: 14,
        fontWeight: 600,
        zIndex: 40,
        boxShadow: '0 10px 28px rgba(11,77,87,0.25)',
      }}
    >
      {children}
    </div>
  );
};

/** Bottom sheet that slides up at `at` (and back down at `until`). */
export const Sheet: React.FC<{ at: number; until?: number; children: React.ReactNode; height?: number }> = ({
  at,
  until = 1e9,
  children,
  height = 420,
}) => {
  const frame = useCurrentFrame();
  const p = ease(frame, at, 12) * (1 - ease(frame, until, 10));
  if (p === 0) return null;
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: `rgba(22,40,46,${0.35 * p})`, zIndex: 20 }} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height,
          transform: `translateY(${(1 - p) * height}px)`,
          background: C.surface,
          borderRadius: '24px 24px 0 0',
          padding: 20,
          zIndex: 30,
          overflow: 'hidden',
        }}
      >
        <div style={{ width: 40, height: 4, borderRadius: 2, background: C.border, margin: '-8px auto 14px' }} />
        {children}
      </div>
    </>
  );
};

// ── title cards ───────────────────────────────────────────────────────────────
export const TitleCard: React.FC<{ kicker: string; title: string; sub: string; bullets?: string[] }> = ({
  kicker,
  title,
  sub,
  bullets = [],
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const logo = useSpring(0, 12);
  const out = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ opacity: out, fontFamily: FONT, color: 'white' }}>
      <Background />
      <AbsoluteFill style={{ padding: 90, justifyContent: 'center' }}>
        <div
          style={{
            width: 150,
            height: 150,
            borderRadius: 40,
            background: C.brand600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `scale(${logo}) rotate(${(1 - logo) * -20}deg)`,
            boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
          }}
        >
          <Drop size={86} />
        </div>
        <Appear at={8}>
          <div style={{ fontSize: 36, fontWeight: 700, marginTop: 56, opacity: 0.85, letterSpacing: 1 }}>{kicker}</div>
        </Appear>
        <Appear at={14}>
          <div style={{ fontSize: 92, fontWeight: 800, lineHeight: 1.05, marginTop: 16, letterSpacing: -2 }}>{title}</div>
        </Appear>
        <Appear at={22}>
          <div style={{ fontSize: 40, fontWeight: 500, lineHeight: 1.35, marginTop: 28, opacity: 0.85 }}>{sub}</div>
        </Appear>
        <div style={{ marginTop: 56 }}>
          {bullets.map((b, i) => (
            <Appear key={b} at={34 + i * 8}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 38, fontWeight: 600, marginTop: 20 }}>
                <span
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: 16,
                    background: 'rgba(255,255,255,0.14)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 28,
                    fontWeight: 800,
                  }}
                >
                  {i + 1}
                </span>
                {b}
              </div>
            </Appear>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** The app-icon water drop (the launcher mark is a white drop on teal). */
export const Drop: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 64 64">
    <path d="M32 6C32 6 12 28 12 41a20 20 0 0 0 40 0C52 28 32 6 32 6Z" fill="white" />
    <path d="M22 42a10 10 0 0 0 8 10" stroke={C.brand600} strokeWidth="5" strokeLinecap="round" fill="none" />
  </svg>
);

// ── screen-level helpers ──────────────────────────────────────────────────────
/** Shows `children[i]` from frame `at[i]`, each new screen sliding in from the right. */
export const Screens: React.FC<{ at: number[]; children: React.ReactNode[] }> = ({ at, children }) => {
  const frame = useCurrentFrame();
  let i = 0;
  at.forEach((a, k) => frame >= a && (i = k));
  const p = i === 0 ? 1 : ease(frame, at[i], 12);
  return (
    <>
      {i > 0 && p < 1 && (
        <div style={{ position: 'absolute', inset: 0, transform: `translateX(${-p * 30}%)`, opacity: 1 - p }}>
          {children[i - 1]}
        </div>
      )}
      <div style={{ position: 'absolute', inset: 0, transform: `translateX(${(1 - p) * 100}%)`, background: C.muted }}>
        {children[i]}
      </div>
    </>
  );
};

/** The part of `text` typed so far: one character every `cps`-th of a second from `from`. */
export const typed = (frame: number, text: string, from: number, perChar = 2) =>
  text.slice(0, Math.max(0, Math.floor((frame - from) / perChar)));

/** Vertical scroll: content moves up by `by` px between frames `from` and `from+dur`. */
export const Scroll: React.FC<{ from: number; by: number; dur?: number; children: React.ReactNode }> = ({
  from,
  by,
  dur = 30,
  children,
}) => {
  const y = ease(useCurrentFrame(), from, dur) * by;
  return <div style={{ transform: `translateY(${-y}px)` }}>{children}</div>;
};

/** Page heading + optional sub line, as the app's screens open. */
export const PageHead: React.FC<{ title: string; sub?: string; right?: React.ReactNode }> = ({ title, sub, right }) => (
  <div style={{ padding: '18px 20px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
    <div>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.5, lineHeight: 1.15 }}>{title}</div>
      {sub && <div style={{ fontSize: 13.5, color: C.textMuted, marginTop: 4, lineHeight: 1.35 }}>{sub}</div>}
    </div>
    {right}
  </div>
);

/** A labelled input showing `value`; a caret blinks while `focus`. */
export const Field: React.FC<{ label: string; value: string; placeholder?: string; prefix?: string; focus?: boolean; big?: boolean }> = ({
  label,
  value,
  placeholder,
  prefix,
  focus,
  big,
}) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: C.surface,
          border: `1.5px solid ${focus ? C.brand600 : C.border}`,
          borderRadius: 12,
          padding: big ? '12px 14px' : '10px 12px',
          fontSize: big ? 20 : 15,
          fontWeight: big ? 800 : 500,
          minHeight: 20,
        }}
      >
        {prefix && <span style={{ color: C.textMuted, fontWeight: 600 }}>{prefix}</span>}
        <span style={{ color: value ? C.text : C.textMuted }}>{value || placeholder}</span>
        {focus && Math.floor(frame / 15) % 2 === 0 && (
          <span style={{ width: 2, height: big ? 22 : 18, background: C.brand600, marginLeft: -6 }} />
        )}
      </div>
    </div>
  );
};

/** Wrap a control: a finger taps its centre (and the control dips) at each frame in `at`. */
export const Tapped: React.FC<{ at: number | number[]; children: React.ReactNode; style?: React.CSSProperties }> = ({
  at,
  children,
  style,
}) => {
  const frame = useCurrentFrame();
  const taps = [at].flat();
  const down = taps.some((a) => frame >= a && frame < a + 6);
  return (
    <div style={{ position: 'relative', transform: down ? 'scale(0.96)' : undefined, ...style }}>
      {children}
      {taps.map((a) => (
        <Tap key={a} at={a} />
      ))}
    </div>
  );
};

/**
 * Tutorial pointer (not app UI): an amber outline around the wrapped element from `at` to `until`,
 * with an optional label above or below it.
 */
export const Spot: React.FC<{
  at: number;
  until?: number;
  text?: string;
  place?: 'above' | 'below';
  align?: 'left' | 'center' | 'right';
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ at, until = 1e9, text, place = 'below', align = 'center', children, style }) => {
  const frame = useCurrentFrame();
  const p = ease(frame, at, 10) * (1 - ease(frame, until, 8));
  return (
    <div style={{ position: 'relative', zIndex: p > 0 ? 45 : undefined, ...style }}>
      {children}
      {p > 0 && (
        <>
          <div
            style={{
              position: 'absolute',
              inset: -5,
              borderRadius: 18,
              border: `3px solid ${C.amber}`,
              boxShadow: `0 0 0 ${4 + Math.sin(frame / 5) * 2}px rgba(208,148,21,0.25)`,
              opacity: p,
              transform: `scale(${0.94 + p * 0.06})`,
              pointerEvents: 'none',
            }}
          />
          {text && (
            <div
              style={{
                position: 'absolute',
                [place === 'below' ? 'top' : 'bottom']: 'calc(100% + 14px)',
                ...(align === 'center'
                  ? { left: '50%', transform: `translateX(-50%) translateY(${(1 - p) * 8}px)` }
                  : { [align]: 0, transform: `translateY(${(1 - p) * 8}px)` }),
                width: 'max-content',
                maxWidth: 330,
                opacity: p,
                background: C.amber,
                color: '#1f1400',
                fontWeight: 800,
                fontSize: 13.5,
                lineHeight: 1.35,
                padding: '8px 12px',
                borderRadius: 12,
                boxShadow: '0 8px 20px rgba(0,0,0,0.18)',
                textAlign: 'center',
              }}
            >
              {text}
            </div>
          )}
        </>
      )}
    </div>
  );
};

/** A row with a label on the left and a value on the right. */
export const Row: React.FC<{ k: React.ReactNode; v: React.ReactNode; strong?: boolean }> = ({ k, v, strong }) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '8px 0',
      fontSize: strong ? 16 : 14,
      fontWeight: strong ? 800 : 500,
    }}
  >
    <span style={{ color: strong ? C.text : C.textMuted }}>{k}</span>
    <span>{v}</span>
  </div>
);
