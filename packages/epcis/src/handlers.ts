import { createValidator } from './validation.js';
import type { Publisher, CaptureResult, CaptureOptions } from './types.js';

export interface CaptureConfig {
  paranetId: string;
  publisher: Publisher;
}

export interface CaptureRequest {
  epcisDocument: unknown;
  publishOptions?: CaptureOptions;
}

export class EpcisValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`EPCIS validation failed: ${errors.join('; ')}`);
    this.name = 'EpcisValidationError';
  }
}

const validator = createValidator();

export async function handleCapture(
  request: CaptureRequest,
  config: CaptureConfig,
): Promise<CaptureResult> {
  const validation = validator.validate(request.epcisDocument);

  if (!validation.valid) {
    throw new EpcisValidationError(validation.errors!);
  }

  const opts = request.publishOptions
    ? { accessPolicy: request.publishOptions.accessPolicy, allowedPeers: request.publishOptions.allowedPeers }
    : undefined;

  const result = await config.publisher.publish(config.paranetId, request.epcisDocument, opts);

  return {
    ual: result.ual,
    kcId: result.kcId,
    receivedAt: new Date().toISOString(),
    eventCount: validation.eventCount!,
    status: result.status,
  };
}
