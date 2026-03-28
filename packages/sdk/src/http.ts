import { DKGSDKError } from './errors.js';

interface HttpClientOptions {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;

  constructor(opts: HttpClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.headers = opts.headers ?? {};
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          ...this.headers,
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorPayload = await res.json().catch(() => ({ error: res.statusText }));
        throw new DKGSDKError(
          String((errorPayload as Record<string, unknown>).error ?? `HTTP ${res.status}`),
          { status: res.status, causeData: errorPayload },
        );
      }

      return res.json() as Promise<T>;
    } catch (err) {
      if (err instanceof DKGSDKError) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new DKGSDKError(`Request timed out after ${this.timeoutMs}ms`, { code: 'ETIMEDOUT' });
      }
      throw new DKGSDKError(err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
  }
}
