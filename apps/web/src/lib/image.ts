'use client';

/**
 * Downscale an image to at most `max` px on its longest side and re-encode as
 * JPEG, so phone photos (~4 MB) drop well under the 5 MB upload cap before they
 * hit the network. Native canvas — no dependency. Returns the original file
 * untouched if it is not a raster image or already small enough.
 */
export async function compressImage(
  file: File,
  max = 1600,
  quality = 0.8,
): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // decode failed (exotic format) — let the server validate it
  }

  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  // Already small and lightweight → skip the re-encode round-trip.
  if (scale === 1 && file.size <= 1_000_000) {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  );
  return blob ?? file;
}
