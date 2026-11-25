'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/locale-context';

import { Button } from '@/components/ui';
import { FRAME_CONTRAST_MIN, frameContrast } from '@/lib/frame-quality';

const SAMPLE = 64; // downscale size for the cheap contrast math

/**
 * Live camera preview + single-frame capture. Returns the JPEG data-URL plus a capture-quality
 * verdict (`live`, the prop's historical name): false for a black, covered or washed-out frame,
 * which is not worth sending. It is not a security control — the server's face match decides
 * identity (B-7).
 *
 * 2026-11-25: it no longer asks the person to move. The old gate wanted motion between two
 * frames 350 ms after the tap: a blink never cleared it, a head turn had to land in that window,
 * and the frame sent was the blurred mid-movement one. The frame is now taken the moment the
 * button is pressed, with the face held still.
 */
export function FaceCapture({ onCapture, disabled }: { onCapture: (dataUrl: string, live: boolean) => void; disabled?: boolean }) {
  const { t } = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  /*
   * CA-1-55: a retry counter, and the whole reason this component needs one.
   *
   * Opening the camera failed and the screen printed one line of red text with no way
   * forward — no button, nothing. An employee who denied the permission by accident, or
   * whose camera was held by another app, had exactly one option: reload the page, on a
   * screen reached by clocking in. Bumping this re-runs the effect, which asks again.
   */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setReady(false);
    // Prefer the front camera, but fall back to any camera — some devices (and headless
    // fake devices) reject the facingMode constraint outright.
    (navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user' }, audio: false }) ??
      Promise.reject(new Error('no mediaDevices')))
      .catch(() => navigator.mediaDevices.getUserMedia({ video: true, audio: false }))
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
      .catch(() => setError(t('hrFix.faceCapture2.cameraDenied')));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
    // `t` is deliberately not a dependency: this effect OPENS THE CAMERA, and re-running it
    // when the language toggles would stop and restart the stream mid-capture. The message
    // is only read at failure time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  /** Downscaled grayscale sample of the current frame, for the contrast math. */
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

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    // One frame, the one on screen when the button is pressed: judged and sent together.
    const usable = frameContrast(graySample(video)) >= FRAME_CONTRAST_MIN;

    const full = document.createElement('canvas');
    full.width = video.videoWidth || 480;
    full.height = video.videoHeight || 480;
    full.getContext('2d')?.drawImage(video, 0, 0, full.width, full.height);
    onCapture(full.toDataURL('image/jpeg', 0.85), usable);
  }, [graySample, onCapture]);

  if (error) {
    return (
      <div className="space-y-2.5 text-center">
        {/* `text-red-600` is a raw colour that does not follow the theme; the token does. */}
        <p className="text-sm text-[color:var(--danger)]" role="alert">
          {error}
        </p>
        <Button type="button" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
          {t('hrFix.faceCapture2.retry')}
        </Button>
        <p className="text-xs text-muted">{t('hrFix.faceCapture2.retryHint')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <video ref={videoRef} autoPlay playsInline muted className="mx-auto aspect-square w-full max-w-xs rounded-2xl bg-black object-cover" />
      <Button type="button" onClick={capture} disabled={disabled || !ready} className="w-full">{t('hrFix.faceCapture.take')}</Button>
      <p className="text-center text-xs text-muted">{t('hrFix.faceCapture.hint')}</p>
    </div>
  );
}
