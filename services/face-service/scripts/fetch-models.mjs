#!/usr/bin/env node
/**
 * Fetch the two pinned models into <dir> — run by the image build.
 *
 * Not `ADD --checksum` from one URL: opencv_zoo serves them through Git LFS, whose bandwidth
 * quota belongs to a busy public repo, and one refused download would fail the Images run —
 * which every deploy waits on. So: the LFS file at the pinned commit first, opencv's own
 * Hugging Face mirror second, a few tries each, and the same sha256 either way. A file that
 * does not hash to its pin is never written.
 *
 * usage: node fetch-models.mjs <dir>
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const COMMIT = '48b10fa505aeb51fbd127fc60a5c660040e823b7';
// opencv's Hugging Face repos, at a fixed revision too: `resolve/main` would follow any
// re-export onto a hash that can never match, and the fallback would quietly stop existing.
const HF_YUNET = '3cc26e7f1014a5ee5d74a42acee58bafc9d0a310';
const HF_SFACE = '3d7082438a6e4551e840c9b2bb60b71e8da4b524';
const MODELS = [
  {
    file: 'face_detection_yunet_2023mar.onnx',
    sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4',
    urls: [
      `https://media.githubusercontent.com/media/opencv/opencv_zoo/${COMMIT}/models/face_detection_yunet/face_detection_yunet_2023mar.onnx`,
      `https://huggingface.co/opencv/face_detection_yunet/resolve/${HF_YUNET}/face_detection_yunet_2023mar.onnx`,
    ],
  },
  {
    file: 'face_recognition_sface_2021dec.onnx',
    sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79',
    urls: [
      `https://media.githubusercontent.com/media/opencv/opencv_zoo/${COMMIT}/models/face_recognition_sface/face_recognition_sface_2021dec.onnx`,
      `https://huggingface.co/opencv/face_recognition_sface/resolve/${HF_SFACE}/face_recognition_sface_2021dec.onnx`,
    ],
  },
];
const TRIES = 3;

/** An answer no retry can change: a 4xx other than 429, or bytes that do not hash to the pin. */
class Permanent extends Error {}

async function fetchPinned({ file, sha256, urls }) {
  const errors = [];
  for (const url of urls) {
    for (let attempt = 1; attempt <= TRIES; attempt++) {
      try {
        const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(180_000) });
        if (!res.ok) {
          const msg = `HTTP ${res.status}`;
          throw res.status >= 400 && res.status < 500 && res.status !== 429 ? new Permanent(msg) : new Error(msg);
        }
        const bytes = Buffer.from(await res.arrayBuffer());
        const got = createHash('sha256').update(bytes).digest('hex');
        if (got !== sha256) throw new Permanent(`sha256 ${got} is not the pinned ${sha256}`);
        return bytes;
      } catch (err) {
        errors.push(`${url} (try ${attempt}): ${err instanceof Error ? err.message : String(err)}`);
        // The next host, not the same answer again; and no wait after the last try.
        if (err instanceof Permanent) break;
        if (attempt < TRIES) await new Promise((r) => setTimeout(r, attempt * 5000));
      }
    }
  }
  throw new Error(`could not fetch ${file}:\n  ${errors.join('\n  ')}`);
}

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node fetch-models.mjs <dir>');
  process.exit(2);
}
mkdirSync(dir, { recursive: true });
for (const model of MODELS) {
  const bytes = await fetchPinned(model);
  writeFileSync(join(dir, model.file), bytes);
  console.log(`${model.file}: ${bytes.length} bytes, sha256 matches the pin`);
}
