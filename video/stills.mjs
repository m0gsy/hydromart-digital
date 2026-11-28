// Dev aid: render chosen frames as PNGs to eyeball layout without a full render.
//   node stills.mjs <CompositionId> <outDir> <frame> [frame...]
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { join } from 'node:path';

const [id, out, ...fr] = process.argv.slice(2);
const serveUrl = await bundle({ entryPoint: join(import.meta.dirname, 'src/index.ts') });
const browserExecutable = process.env.REMOTION_BROWSER ?? null;
const composition = await selectComposition({ serveUrl, id, browserExecutable });
for (const f of fr) {
  await renderStill({ serveUrl, composition, frame: Number(f), output: join(out, `${id}-${f}.png`), scale: 0.5, browserExecutable });
  console.log('still', f);
}
