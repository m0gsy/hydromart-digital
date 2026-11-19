import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class FaceConfigService {
  constructor(private readonly config: ConfigService) {}

  get port(): number {
    return Number(this.config.getOrThrow('FACE_SERVICE_PORT'));
  }
  get modelDir(): string {
    return this.config.getOrThrow<string>('FACE_MODEL_DIR');
  }
  get queueMax(): number {
    return Number(this.config.getOrThrow('FACE_QUEUE_MAX'));
  }
  get inferTimeoutMs(): number {
    return Number(this.config.getOrThrow('FACE_INFER_TIMEOUT_MS'));
  }
}
