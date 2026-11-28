/**
 * The cashier's opt-in QR: one SVG path for the dark modules of `text`, plus the module count.
 *
 * `qrcode-generator` (MIT, no dependencies) is imported on demand, so no other screen carries it.
 * Drawn as React SVG instead of an `<img src="data:...">`, so it needs no extra `img-src` allowance
 * and no HTML string is ever injected.
 */
export async function qrPath(text: string): Promise<{ size: number; d: string }> {
  const { default: qrcode } = await import('qrcode-generator');
  // ponytail: type 0 = smallest version that fits, level M = survives a smudged counter screen.
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  let d = '';
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
    }
  }
  return { size, d };
}
