'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui';

/**
 * Live camera preview + single-frame capture (returns a JPEG data-URL). Used by admin
 * face enrollment and self check-in/out. ponytail: manual capture only — passive
 * liveness (MediaPipe blink/head-turn) is deferred; the server verifier gates the match.
 */
export function FaceCapture({ onCapture, disabled }: { onCapture: (dataUrl: string) => void; disabled?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

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

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 480;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    onCapture(canvas.toDataURL('image/jpeg', 0.85));
  }, [onCapture]);

  if (error) return <p className="text-sm text-red-600" role="alert">{error}</p>;

  return (
    <div className="space-y-3">
      <video ref={videoRef} autoPlay playsInline muted className="mx-auto aspect-square w-full max-w-xs rounded-2xl bg-black object-cover" />
      <Button type="button" onClick={capture} disabled={disabled || !ready} className="w-full">Ambil Foto</Button>
    </div>
  );
}
