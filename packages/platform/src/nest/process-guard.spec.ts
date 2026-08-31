/*
 * Both modules are MOCKED rather than spied. `@sentry/node` exports `flush` as a
 * non-configurable binding, so `jest.spyOn` throws "Cannot redefine property: flush" —
 * measured, not guessed. Mocking also keeps the real alerter from firing a webhook out of
 * a unit test.
 */
jest.mock('@sentry/node', () => ({ flush: jest.fn().mockResolvedValue(true) }));
jest.mock('./error-alerter', () => ({ alertServerError: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Sentry = require('@sentry/node') as { flush: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const alerter = require('./error-alerter') as { alertServerError: jest.Mock };

/*
 * A process that dies away from a request used to die in silence.
 *
 * Measured 2026-08-31: `grep -rn 'unhandledRejection|uncaughtException'` across every service
 * and package found NOTHING in application code. Everything reported travelled through
 * `AllExceptionsFilter`, which only ever sees a 5xx Nest routed — so `void bootstrap()`
 * rejecting, a scheduler sweep throwing, or Postgres dropping between requests produced a
 * stack on stdout and nothing anywhere a human would look.
 *
 * The two properties below are the whole contract, and they pull against each other: SAY so,
 * and still DIE. Reporting without dying leaves a process in a state nobody can reason about;
 * dying without reporting is what it already did.
 */
describe('guardProcess', () => {
  const listeners: Record<string, ((arg: unknown) => void)[]> = {};
  let alerted: jest.Mock;
  let flushed: jest.Mock;
  let exited: jest.SpyInstance;
  let onSpy: jest.SpyInstance;
  let errorLog: jest.SpyInstance;
  let flushRejects = false;

  beforeEach(() => {
    flushRejects = false;
    for (const key of Object.keys(listeners)) delete listeners[key];
    onSpy = jest.spyOn(process, 'on').mockImplementation(((event: string, fn: (a: unknown) => void) => {
      (listeners[event] ??= []).push(fn);
      return process;
    }) as never);
    exited = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    alerter.alertServerError.mockReset();
    Sentry.flush.mockReset().mockResolvedValue(true);
    alerted = alerter.alertServerError;
    flushed = Sentry.flush;
  });

  afterEach(() => {
    onSpy.mockRestore();
    exited.mockRestore();
    errorLog.mockRestore();
  });

  /*
   * `resetModules` hands the fresh process-guard a FRESH copy of both mocks, so the handles
   * captured in `beforeEach` are no longer the ones it calls. Measured: every assertion read
   * zero calls while the guard was working perfectly. So the handles are re-grabbed AFTER
   * the reset, from the same registry the module under test is using.
   */
  const install = (): void => {
    jest.resetModules();
    /* eslint-disable @typescript-eslint/no-var-requires */
    alerted = (require('./error-alerter') as { alertServerError: jest.Mock }).alertServerError;
    flushed = (require('@sentry/node') as { flush: jest.Mock }).flush;
    alerted.mockReset();
    flushed.mockReset().mockResolvedValue(true);
    if (flushRejects) flushed.mockRejectedValue(new Error('sentry unreachable'));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    (require('./process-guard') as { guardProcess: (n: string) => void }).guardProcess('order-service');
    /* eslint-enable @typescript-eslint/no-var-requires */
  };

  it('listens for the two failures nothing else in this platform sees', () => {
    install();
    expect(Object.keys(listeners).sort()).toEqual(['uncaughtException', 'unhandledRejection']);
  });

  it('reports an uncaught exception through the same door as a 5xx', () => {
    install();
    const boom = new Error('database is on fire');
    listeners.uncaughtException![0]!(boom);

    expect(alerted).toHaveBeenCalledTimes(1);
    const sent = alerted.mock.calls[0]![0] as { path: string; exception: unknown };
    // The service name has to be IN it: eighteen processes report to one channel, and
    // "something crashed" is not actionable.
    expect(sent.path).toContain('order-service');
    expect(sent.exception).toBe(boom);
  });

  it('reports an unhandled rejection too — that is how a failed bootstrap arrives', () => {
    install();
    listeners.unhandledRejection![0]!(new Error('bootstrap failed'));

    expect(alerted).toHaveBeenCalledTimes(1);
    expect((alerted.mock.calls[0]![0] as { path: string }).path).toContain('unhandledRejection');
  });

  it('still dies afterwards — reporting must not turn a crash into a zombie', async () => {
    install();
    listeners.uncaughtException![0]!(new Error('boom'));
    await Promise.resolve();
    await Promise.resolve();

    expect(exited).toHaveBeenCalledWith(1);
  });

  it('flushes BEFORE dying, or the report loses the race with the exit', async () => {
    install();
    listeners.uncaughtException![0]!(new Error('boom'));

    // Flush is requested synchronously; the exit only happens once it settles.
    expect(flushed).toHaveBeenCalled();
    expect(exited).not.toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
    expect(exited).toHaveBeenCalledWith(1);
  });

  it('dies even when the flush itself fails', async () => {
    flushRejects = true;
    install();
    listeners.uncaughtException![0]!(new Error('boom'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // An unreachable reporter must not be what keeps a broken process alive.
    expect(exited).toHaveBeenCalledWith(1);
  });

  it('installs once, however many times it is called', () => {
    install();
    const first = listeners.uncaughtException!.length;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    (require('./process-guard') as { guardProcess: (n: string) => void }).guardProcess('order-service');
    expect(listeners.uncaughtException!.length).toBe(first);
  });
});
