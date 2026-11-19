import { EmbedService } from '../../src/application/embed.service';
import { FaceConfigService } from '../../src/config/face-config.service';
import { EngineBusyError } from '../../src/domain/errors';
import type { EmbedResult, FaceEngine } from '../../src/infrastructure/onnx-face.engine';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const result = (n: number): EmbedResult => ({ vector: [n], detScore: 0.9 });
const config = (queueMax: number) => ({ queueMax }) as FaceConfigService;

describe('EmbedService', () => {
  it('runs one inference at a time, in order', async () => {
    const first = deferred<EmbedResult>();
    const started: number[] = [];
    let calls = 0;
    const engine: FaceEngine = {
      selfCheck: async () => undefined,
      embed: () => {
        const n = ++calls;
        started.push(n);
        return n === 1 ? first.promise : Promise.resolve(result(n));
      },
    };
    const svc = new EmbedService(engine, config(8));
    const a = svc.embed(Buffer.from('a'));
    const b = svc.embed(Buffer.from('b'));
    await new Promise((r) => setImmediate(r));
    expect(started).toEqual([1]); // b waits for a
    first.resolve(result(1));
    await expect(a).resolves.toEqual(result(1));
    await expect(b).resolves.toEqual(result(2));
  });

  it('refuses at once (503) past the limit, instead of queueing without end', async () => {
    const hold = deferred<EmbedResult>();
    const engine: FaceEngine = { selfCheck: async () => undefined, embed: () => hold.promise };
    const svc = new EmbedService(engine, config(1));
    const a = svc.embed(Buffer.from('a'));
    await expect(svc.embed(Buffer.from('b'))).rejects.toBeInstanceOf(EngineBusyError);
    hold.resolve(result(1));
    await a;
    // Room again once the first settled.
    await expect(svc.embed(Buffer.from('c'))).resolves.toEqual(result(1));
  });

  it('passes a failure to its caller and keeps serving the next one', async () => {
    let calls = 0;
    const engine: FaceEngine = {
      selfCheck: async () => undefined,
      embed: async () => {
        calls += 1;
        if (calls === 1) throw new Error('engine fell over');
        return result(calls);
      },
    };
    const svc = new EmbedService(engine, config(8));
    await expect(svc.embed(Buffer.from('a'))).rejects.toThrow('engine fell over');
    await expect(svc.embed(Buffer.from('b'))).resolves.toEqual(result(2));
  });
});
