import { Inject, Injectable } from '@nestjs/common';

import { FaceConfigService } from '../config/face-config.service';
import { EngineBusyError } from '../domain/errors';
import { FACE_ENGINE, type EmbedResult, type FaceEngine } from '../infrastructure/onnx-face.engine';

/**
 * One inference at a time, at most `FACE_QUEUE_MAX` waiting (the running one included).
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

  async embed(jpeg: Buffer): Promise<EmbedResult> {
    if (this.inFlight >= this.config.queueMax) throw new EngineBusyError();
    this.inFlight += 1;
    const run = this.tail.then(() => this.engine.embed(jpeg));
    // The next one waits for this one to settle, however it ends.
    this.tail = run.catch(() => undefined);
    try {
      return await run;
    } finally {
      this.inFlight -= 1;
    }
  }
}
