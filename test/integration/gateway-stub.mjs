// Minimal payment-gateway stub for the integration test. Stands in for the
// external provider so online payments (QRIS/EWALLET/VA) get a PENDING charge +
// reference — which is what lets the signed-webhook PAID path run end to end
// (payment settles -> order-service internal-confirm -> order CONFIRMED).
// ponytail: fixed happy-path responses only, no real charge state — it exists to
// make the online -> webhook chain reachable, not to model a real gateway.
import { createServer } from 'node:http';

const PORT = Number(process.env.STUB_PORT ?? 9100);

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

createServer(async (req, res) => {
  const body = await readBody(req);
  res.setHeader('content-type', 'application/json');
  if (req.method === 'POST' && req.url === '/charges') {
    // Echo the payment id so the reference is unique + traceable.
    res.end(JSON.stringify({ reference: `STUB-${body.paymentId ?? Date.now()}`, instruction: 'Pay using the stub reference.' }));
  } else if (req.method === 'POST' && req.url === '/refunds') {
    res.end(JSON.stringify({ reference: body.reference ?? 'STUB-REFUND' }));
  } else {
    res.statusCode = 404;
    res.end('{}');
  }
}).listen(PORT, () => console.log(`gateway-stub listening on ${PORT}`));
