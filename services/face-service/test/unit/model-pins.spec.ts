import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DETECTOR_MODEL, MODEL_SHA256, RECOGNIZER_MODEL } from '../../src/infrastructure/onnx-face.engine';

/**
 * The pins live twice: in the engine (checked at every boot) and in scripts/fetch-models.mjs
 * (checked when the image downloads them). A model bump that edits one would fetch a file the
 * other refuses — at boot, with a message that does not point at the script.
 */
describe('model pins', () => {
  const script = readFileSync(join(__dirname, '../../scripts/fetch-models.mjs'), 'utf8');

  it.each([DETECTOR_MODEL, RECOGNIZER_MODEL])('%s is pinned to the same hash in the fetch script', (file) => {
    const block = new RegExp(`file: '${file.replace(/\./g, '\\.')}',\\s*sha256: '([0-9a-f]{64})'`).exec(script);
    expect(block?.[1]).toBe(MODEL_SHA256[file]);
  });
});
