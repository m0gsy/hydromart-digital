'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui';

// Liveness thresholds (empirical). Tune per camera; the server verifier still gates identity.
const MOTION_MIN = 6; // mean per-pixel grayscale delta between two frames ~350ms apart
const SHARP_MIN = 12; // stddev of grayscale — rejects a black/blurred frame
const SAMPLE = 64; // downscale size for the cheap motion/sharpness math

/**
 * Live camera preview + single-frame capture. Returns the JPEG data-URL plus a passive
 * liveness verdict computed from inter-frame motion + sharpness (a real photo held still,
 * or a black/blur frame, fails). ponytail: motion+sharpness proxy — a moving printed photo
 * can still pass; upgrade to MediaPipe blink/head-turn landmarks if spoofing matters. The
 * server ArcFace verifier gates identity regardless.
 */
export function FaceCapture({ onCapture, disabled }: { onCapture: (dataUrl: string, live: boolean) => void; disabled?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setReady(true);
        }
      })
      .catch(() => setError('Tidak bisa mengakses kamera. Izinkan akses kamera lalu muat ulang.'));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  /** Downscaled grayscale samples of the current frame, for motion/sharpness math. */
  const graySample = useCallback((video: HTMLVideoElement): Uint8ClampedArray => {
    const c = document.createElement('canvas');
    c.width = SAMPLE;
    c.height = SAMPLE;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(video, 0, 0, SAMPLE, SAMPLE);
    const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE);
    const gray = new Uint8ClampedArray(SAMPLE * SAMPLE);
    for (let i = 0; i < gray.length; i++) {
      gray[i] = (data[i * 4]! * 0.299 + data[i * 4 + 1]! * 0.587 + data[i * 4 + 2]! * 0.114) | 0;
    }
    return gray;
  }, []);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setBusy(true);

    // Two grayscale samples ~350ms apart → motion; stddev of the 2nd → sharpness.
    const a = graySample(video);
    await new Promise((r) => setTimeout(r, 350));
    const b = graySample(video);
    let motion = 0;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      motion += Math.abs(a[i]! - b[i]!);
      sum += b[i]!;
    }
    motion /= a.length;
    const mean = sum / b.length;
    let variance = 0;
    for (let i = 0; i < b.length; i++) variance += (b[i]! - mean) ** 2;
    const sharpness = Math.sqrt(variance / b.length);
    const live = motion >= MOTION_MIN && sharpness >= SHARP_MIN;

    const full = document.createElement('canvas');
    full.width = video.videoWidth || 480;
    full.height = video.videoHeight || 480;
    full.getContext('2d')?.drawImage(video, 0, 0, full.width, full.height);
    onCapture(full.toDataURL('image/jpeg', 0.85), live);
    setBusy(false);
  }, [graySample, onCapture]);

  if (error) return <p className="text-sm text-red-600" role="alert">{error}</p>;

  return (
    <div className="space-y-3">
      <video ref={videoRef} autoPlay playsInline muted className="mx-auto aspect-square w-full max-w-xs rounded-2xl bg-black object-cover" />
      <Button type="button" onClick={capture} loading={busy} disabled={disabled || !ready} className="w-full">Ambil Foto</Button>
      <p className="text-center text-xs text-muted">Gerakkan kepala sedikit / kedipkan mata saat mengambil foto.</p>
    </div>
  );
}
