/**
 * Whether a camera frame is worth sending for a face match.
 *
 * The capture gate on the device, not a security control: the server's face match decides
 * identity (B-7). Contrast — the standard deviation of a downscaled grayscale sample — is what
 * tells a frame with a face and a room in it from a black frame, a covered lens or a washed-out
 * one, which are all nearly a single gray.
 *
 * Until 2026-11-25 the gate also demanded movement between two frames 350 ms apart. A blink
 * never cleared that bar on a 64×64 sample, a head turn had to land inside the window, and the
 * frame sent was the one taken mid-movement — so people tapped again and again, and NEO was
 * handed blurred faces. The contrast bar below is the old one, unchanged: every frame the old
 * gate accepted, this one accepts too.
 */
export const FRAME_CONTRAST_MIN = 12;

/** Population standard deviation of the gray levels; 0 for an empty sample. */
export function frameContrast(gray: ArrayLike<number>): number {
  const n = gray.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += gray[i]!;
  const mean = sum / n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (gray[i]! - mean) ** 2;
  return Math.sqrt(variance / n);
}
