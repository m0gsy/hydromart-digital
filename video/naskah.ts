// Writes NASKAH_VO.md from src/script.ts and refuses a scene whose voice-over cannot be read
// calmly in the time the scene is on screen.   node naskah.ts
import { writeFileSync } from 'node:fs';
import { ABSENSI, FPS, KEPALA, PELANGGAN, STAFF, type Scene } from './src/script.ts';

// ponytail: words/second is a rough proxy for spoken length; time a real read if a scene feels rushed.
const MAX_WPS = 2.4;

const ts = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function section(name: string, file: string, scenes: Scene[]) {
  let t = 0;
  const rows = scenes.map((s, i) => {
    const words = s.vo.split(/\s+/).length;
    if (words / s.sec > MAX_WPS) {
      throw new Error(`${name} "${s.id}": ${words} kata dalam ${s.sec} detik terlalu cepat (> ${MAX_WPS}/detik)`);
    }
    const head = `### ${i + 1}. ${s.step ? `${s.step} — ` : ''}${s.title}  \`${ts(t)}–${ts(t + s.sec)}\``;
    t += s.sec;
    return `${head}\n\n**Teks layar:** ${s.caption}\n\n> ${s.vo}\n`;
  });
  return `## ${name}\n\nBerkas: \`out/${file}\` · durasi ${ts(t)} · ${t * FPS} frame @ ${FPS} fps\n\n${rows.join('\n')}`;
}

const md = `# Naskah voice-over — Tutorial Hydromart Ops

Dibuat otomatis dari \`src/script.ts\` (\`npm run naskah\`). Jangan diedit langsung: ubah \`script.ts\`,
lalu jalankan ulang agar naskah dan video tetap sinkron.

**Suara:** berkas \`public/vo/<video>-<nomor>.mp3\` dibuat dari naskah ini dengan ElevenLabs
(\`npm run vo\`, lihat README). Untuk memakai rekaman sendiri, rekam satu berkas per adegan dengan
nama yang sama, lalu render ulang. Bacaan dirancang ±${MAX_WPS} kata/detik, dan suara dimulai
0,4 detik setelah adegannya mulai.

${section('Video 1 — Staff Depot', 'tutorial-staff-depot.mp4', STAFF)}
${section('Video 2 — Kepala Depot', 'tutorial-kepala-depot.mp4', KEPALA)}
${section('Video 3 — Pelanggan', 'tutorial-pelanggan.mp4', PELANGGAN)}
${section('Video 4 — Absensi', 'tutorial-absensi.mp4', ABSENSI)}`;

writeFileSync(new URL('./NASKAH_VO.md', import.meta.url), md);
console.log('NASKAH_VO.md ditulis');
