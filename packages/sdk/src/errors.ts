export class DKGSDKError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly causeData?: unknown;

  constructor(message: string, opts?: { status?: number; code?: string; causeData?: unknown }) {
    super(message);
    this.name = 'DKGSDKError';
    this.status = opts?.status;
    this.code = opts?.code;
    this.causeData = opts?.causeData;
  }
}
