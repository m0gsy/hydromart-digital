// Generates the voice-over files from src/script.ts with ElevenLabs text-to-speech, then checks every
// line fits its scene.   XI_API_KEY=... node vo.ts
//
// One mp3 per scene in public/vo/<video>-NN.mp3, the names Root.tsx looks for. A line whose text,
// voice and delivery are unchanged since the last run is not paid for twice (public/vo/manifest.json).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ABSENSI, FPS, KEPALA, PELANGGAN, STAFF, VO_DELAY, type Scene } from './src/script.ts';

const KEY = process.env.XI_API_KEY;
if (!KEY) throw new Error('Set XI_API_KEY (ElevenLabs API key).');
const MODEL = 'eleven_multilingual_v2';
// The "most emotive" model (ElevenLabs, 2026). It takes no style knob: the delivery comes from the
// voice and from how the line is written.
const V4 = 'eleven_v4';

// Both voices are standard-accent Indonesian voices from the ElevenLabs Voice Library.
const ARUNIKA = 'o5s6XRBkPSTD4syv6mZg'; // "National TV Voice Over": a calm, even read
const CAHAYA = 'iWydkXKoiVtvdn4vLKp9'; // "Youthful, Clear and Engaging": picked by the owner from four v4 samples
const STEADY = { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true };

type Settings = typeof STEADY | undefined;
const VIDEOS: { prefix: string; scenes: Scene[]; voice: string; model: string; settings: Settings }[] = [
  { prefix: 'staff', scenes: STAFF, voice: ARUNIKA, model: MODEL, settings: STEADY },
  { prefix: 'kepala', scenes: KEPALA, voice: ARUNIKA, model: MODEL, settings: STEADY },
  { prefix: 'pelanggan', scenes: PELANGGAN, voice: ARUNIKA, model: MODEL, settings: STEADY },
  // A written-style read on multilingual_v2 was found stiff twice; v4 with its default delivery.
  { prefix: 'absensi', scenes: ABSENSI, voice: CAHAYA, model: V4, settings: undefined },
];

const dir = new URL('./public/vo/', import.meta.url);
mkdirSync(dir, { recursive: true });
const manifestUrl = new URL('manifest.json', dir);
const manifest: Record<string, string> = existsSync(manifestUrl) ? JSON.parse(readFileSync(manifestUrl, 'utf8')) : {};

const seconds = (file: URL) =>
  Number(
    execFileSync('npx', ['remotion', 'ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file.pathname], {
      encoding: 'utf8',
    }).trim(),
  );

async function speak(text: string, voice: string, model: string, settings: Settings, out: URL) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: model, language_code: 'id', ...(settings ? { voice_settings: settings } : {}) }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
}

const tooLong: string[] = [];
for (const { prefix, scenes, voice, model, settings } of VIDEOS) {
  for (const [i, s] of scenes.entries()) {
    const name = `${prefix}-${String(i + 1).padStart(2, '0')}.mp3`;
    const file = new URL(name, dir);
    // The STEADY lines keep the key they were first made under, so they are not made again.
    const key = `${voice}|${model}|${s.vo}` + (settings === STEADY ? '' : `|${JSON.stringify(settings ?? null)}`);
    const hash = createHash('sha256').update(key).digest('hex').slice(0, 16);
    if (manifest[name] !== hash || !existsSync(file)) {
      await speak(s.vo, voice, model, settings, file);
      manifest[name] = hash;
      writeFileSync(manifestUrl, JSON.stringify(manifest, null, 2) + '\n');
      console.log('dibuat', name);
    }
    const len = seconds(file);
    const room = s.sec - VO_DELAY / FPS - 0.3; // leave the scene's fade-out clear
    console.log(`${name}  ${len.toFixed(1)} dtk / ruang ${room.toFixed(1)} dtk${len > room ? '  ← TERLALU PANJANG' : ''}`);
    if (len > room) tooLong.push(`${name} (${s.id}): ${len.toFixed(1)} dtk, adegan perlu sec ≥ ${Math.ceil(len + VO_DELAY / FPS + 0.3)}`);
  }
}
if (tooLong.length) {
  console.error('\nSuara lebih panjang dari adegannya — naikkan `sec` di src/script.ts:\n' + tooLong.join('\n'));
  process.exit(1);
}
