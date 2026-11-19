import { Inject, Injectable } from '@nestjs/common';

import { FaceConfigService } from '../config/face-config.service';
import { CallerGoneError, EngineBusyError, EngineTimeoutError } from '../domain/errors';
import { FACE_ENGINE, type EmbedResult, type FaceEngine } from '../infrastructure/onnx-face.engine';

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new EngineTimeoutError()), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/**
 * One inference at a time, at most `FACE_QUEUE_MAX` in flight (the running one included).
 *
 * The engine is single-threaded on purpose; two concurrent runs would only share one core
 * and both be late. Past the limit the request is refused (503) at once: hr-service has a
 * deadline of its own, and a queue that keeps growing just turns a burst into a timeout for
 * everybody — and into a container killed for memory.
 */
@Injectable()
export class EmbedService {
  private tail: Promise<unknown> = Promise.resolve();
  private inFlight = 0;

  constructor(
    @Inject(FACE_ENGINE) private readonly engine: FaceEngine,
    private readonly config: FaceConfigService,
  ) {}

  /** `gone` says whether the caller has hung up; checked when this request's turn comes. */
  async embed(jpeg: Buffer, gone: () => boolean = () => false): Promise<EmbedResult> {
    if (this.inFlight >= this.config.queueMax) throw new EngineBusyError();
    this.inFlight += 1;
    const run = this.tail.then(() => {
      // hr-service gave up while this waited (its deadline is shorter than ours): running it
      // anyway would only keep the next live request waiting.
      if (gone()) throw new CallerGoneError();
      return withTimeout(this.engine.embed(jpeg), this.config.inferTimeoutMs);
    });
    // The next one waits for this one to settle, however it ends — a timeout included, so
    // one hung run cannot hold the queue for good.
    this.tail = run.catch(() => undefined);
    try {
      return await run;
    } finally {
      this.inFlight -= 1;
    }
  }
}
