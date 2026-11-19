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
const MODELS = [
  {
    file: 'face_detection_yunet_2023mar.onnx',
    sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4',
    urls: [
      `https://media.githubusercontent.com/media/opencv/opencv_zoo/${COMMIT}/models/face_detection_yunet/face_detection_yunet_2023mar.onnx`,
      'https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx',
    ],
  },
  {
    file: 'face_recognition_sface_2021dec.onnx',
    sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79',
    urls: [
      `https://media.githubusercontent.com/media/opencv/opencv_zoo/${COMMIT}/models/face_recognition_sface/face_recognition_sface_2021dec.onnx`,
      'https://huggingface.co/opencv/face_recognition_sface/resolve/main/face_recognition_sface_2021dec.onnx',
    ],
  },
];
const TRIES = 3;

async function fetchPinned({ file, sha256, urls }) {
  const errors = [];
  for (const url of urls) {
    for (let attempt = 1; attempt <= TRIES; attempt++) {
      try {
        const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(180_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = Buffer.from(await res.arrayBuffer());
        const got = createHash('sha256').update(bytes).digest('hex');
        if (got !== sha256) throw new Error(`sha256 ${got} is not the pinned ${sha256}`);
        return bytes;
      } catch (err) {
        errors.push(`${url} (try ${attempt}): ${err instanceof Error ? err.message : String(err)}`);
        await new Promise((r) => setTimeout(r, attempt * 5000));
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
