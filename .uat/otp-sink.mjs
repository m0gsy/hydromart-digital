// Local SMS gateway stand-in. auth-service runs with OTP_DELIVERY_CHANNEL=sms
// pointed here, so the harness can read verification codes deterministically —
// the console channel writes through pino's buffered stream and the code does
// not reach the log file in time.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'otp.log');

http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    try {
      const { to, text } = JSON.parse(raw);
      const code = text?.match(/(\d{4,8})/)?.[1];
      if (to && code) fs.appendFileSync(OUT, `${Date.now()} ${to} ${code}\n`);
    } catch { /* not an SMS payload */ }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"status":"ok"}');
  });
}).listen(4599, () => console.log('otp sink on :4599'));
