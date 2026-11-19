/**
 * Run by the image build (`RUN node dist/src/selftest.js /app/models test/fixtures`): the real
 * models on real faces, checked against OpenCV's own embeddings of the same files
 * (test/fixtures/reference.json, made by scripts/make-reference.py). An image whose pipeline
 * drifted from OpenCV — a sharp upgrade that changes decoding, an ORT build that computes
 * differently — fails to build instead of matching faces wrongly in production.
 *
 * The fixtures are NASA portraits (public domain), shrunk to 640 px: same_a and same_b are one
 * astronaut years apart, other is another person, noface is the Earth from Apollo 17.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NoFaceError } from './domain/errors';
import { cosine } from './domain/pipeline';
import { createOnnxFaceEngine } from './infrastructure/onnx-face.engine';

/** Node vs OpenCV on the same file. The spike measured 0.9991–0.9999. */
const MIN_PARITY = 0.99;
/** Same person years apart: OpenCV gives 0.64 on this pair. */
const MIN_SAME = 0.5;
/** Two different people: OpenCV gives 0.25 and 0.13. */
const MAX_OTHER = 0.3;

interface Reference {
  images: Record<string, { face: { embedding: number[] } | null }>;
}

async function main(): Promise<void> {
  const [modelDir = '/app/models', fixtures = 'test/fixtures'] = process.argv.slice(2);
  const ref = JSON.parse(readFileSync(join(fixtures, 'reference.json'), 'utf8')) as Reference;
  const engine = await createOnnxFaceEngine(modelDir);
  await engine.selfCheck();

  const failures: string[] = [];
  const got: Record<string, number[]> = {};
  for (const name of ['same_a.jpg', 'same_b.jpg', 'other.jpg']) {
    const { vector, detScore } = await engine.embed(readFileSync(join(fixtures, name)));
    got[name] = vector;
    const want = ref.images[name]?.face?.embedding;
    const parity = want ? cosine(vector, want) : NaN;
    console.log(`${name}: detScore ${detScore.toFixed(3)}, cosine vs OpenCV ${parity.toFixed(4)}`);
    if (!(parity >= MIN_PARITY)) failures.push(`${name} parity ${parity}`);
  }
  try {
    await engine.embed(readFileSync(join(fixtures, 'noface.jpg')));
    failures.push('noface.jpg found a face');
  } catch (err) {
    if (!(err instanceof NoFaceError)) failures.push(`noface.jpg: ${String(err)}`);
  }
  const same = cosine(got['same_a.jpg'], got['same_b.jpg']);
  const other = Math.max(cosine(got['same_a.jpg'], got['other.jpg']), cosine(got['same_b.jpg'], got['other.jpg']));
  console.log(`same person ${same.toFixed(4)}, different people ≤ ${other.toFixed(4)}`);
  if (!(same >= MIN_SAME)) failures.push(`same person ${same}`);
  if (!(other <= MAX_OTHER)) failures.push(`different people ${other}`);

  if (failures.length) {
    console.error(`face-service self-test FAILED:\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('face-service self-test passed');
}

main().catch((err: unknown) => {
  console.error('face-service self-test crashed:', err);
  process.exit(1);
});
