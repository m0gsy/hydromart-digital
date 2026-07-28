import { PaymentConfigService } from '../../src/config/payment-config.service';
import { PaymentGatewayHttpAdapter } from '../../src/infrastructure/http/payment-gateway.http.adapter';
import { OrderCoordinationHttpAdapter } from '../../src/infrastructure/http/order-coordination.http.adapter';
import type { ChargeRequest } from '../../src/application/ports/payment-gateway.port';

// Covers the request-timeout path in both HTTP adapters: the
// `setTimeout(() => controller.abort())` guard that the happy-path specs never
// fire. Fake timers + a fetch that only settles when its signal aborts.

function makeConfig(): PaymentConfigService {
  return {
    gatewayBaseUrl: 'http://gateway:9000',
    gatewayApiKey: 'gw-secret',
    orderServiceUrl: 'http://order:3002',
    internalServiceKey: 'internal-key-01',
  } as unknown as PaymentConfigService;
}

const charge = (): ChargeRequest =>
  ({
    method: 'VA_BCA',
    amount: 57000,
    orderId: 'o1',
    paymentId: 'pay1',
  }) as unknown as ChargeRequest;

const fetchMock = jest.fn();

// Resolves nothing until the AbortController fires — modelling a hung upstream.
function hangUntilAborted() {
  fetchMock.mockImplementation(
    (_url: string, opts: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(new Error('aborted by timeout')));
      }),
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
});

it('payment gateway aborts and fails CLOSED after the timeout window', async () => {
  hangUntilAborted();
  const p = new PaymentGatewayHttpAdapter(makeConfig()).createCharge(charge());
  const assertion = expect(p).rejects.toThrow(/aborted by timeout/);
  await jest.advanceTimersByTimeAsync(8000);
  await assertion;
});

it('order coordination getOrderTotal aborts and fails CLOSED after the timeout', async () => {
  hangUntilAborted();
  const p = new OrderCoordinationHttpAdapter(makeConfig()).getOrderTotal('o1');
  const assertion = expect(p).rejects.toThrow(/aborted by timeout/);
  await jest.advanceTimersByTimeAsync(5000);
  await assertion;
});

it('order coordination confirmPaid aborts and fails OPEN (swallowed) after the timeout', async () => {
  hangUntilAborted();
  const p = new OrderCoordinationHttpAdapter(makeConfig()).confirmPaid('o1');
  const assertion = expect(p).resolves.toBeUndefined();
  await jest.advanceTimersByTimeAsync(5000);
  await assertion;
});
