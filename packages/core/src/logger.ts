import { randomUUID } from 'node:crypto';

export type OperationName = 'publish' | 'query' | 'resolve' | 'connect' | 'sync' | 'system';

export interface OperationContext {
  operationId: string;
  operationName: OperationName;
}

/**
 * Structured logger that prefixes every message with a timestamp,
 * operation name, and operation ID for cross-node log correlation.
 *
 * Format: YYYY-MM-DD HH:MM:SS <operationName> <operationId> "<message>"
 */
export class Logger {
  private readonly prefix: string;

  constructor(private readonly moduleName: string) {
    this.prefix = moduleName;
  }

  info(ctx: OperationContext, message: string): void {
    process.stdout.write(`${this.format(ctx, message)}\n`);
  }

  warn(ctx: OperationContext, message: string): void {
    process.stderr.write(`${this.format(ctx, message)} [WARN]\n`);
  }

  error(ctx: OperationContext, message: string): void {
    process.stderr.write(`${this.format(ctx, message)} [ERROR]\n`);
  }

  private format(ctx: OperationContext, message: string): string {
    const ts = formatTimestamp(new Date());
    return `${ts} ${ctx.operationName} ${ctx.operationId} [${this.prefix}] ${message}`;
  }
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

export function createOperationContext(operationName: OperationName): OperationContext {
  return { operationId: randomUUID(), operationName };
}
