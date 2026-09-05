import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export interface AuditEvent {
  timestamp: string;
  requestId: string;
  action: string;
  outcome: 'started' | 'success' | 'failure' | 'blocked';
  reason?: string;
  sessionId?: string;
  cartId?: string;
  checkoutId?: string;
  authorizationId?: string;
  merchantId?: string;
  amountPaise?: number;
  currency?: string;
  details?: Record<string, string | number | boolean>;
}

export interface AuditQuery {
  requestId?: string;
  cartId?: string;
  checkoutId?: string;
  authorizationId?: string;
}

/** A deliberately small, append-only audit store suitable for the MVP. */
export class AuditStore {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath = path.resolve(process.cwd(), 'data', 'audit.ndjson')) {}

  async record(event: Omit<AuditEvent, 'timestamp'> & { timestamp?: string }): Promise<AuditEvent> {
    const entry: AuditEvent = { ...event, timestamp: event.timestamp ?? new Date().toISOString() };
    const write = async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    };

    this.writeChain = this.writeChain.then(write, write);
    await this.writeChain;
    return entry;
  }

  async find(query: AuditQuery): Promise<AuditEvent[]> {
    try {
      const content = await readFile(this.filePath, 'utf8');
      return content
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as AuditEvent];
          } catch {
            return [];
          }
        })
        .filter((entry) => this.matches(entry, query));
    } catch (error: unknown) {
      if (this.isMissingFile(error)) return [];
      throw error;
    }
  }

  private matches(entry: AuditEvent, query: AuditQuery): boolean {
    return (!query.requestId || entry.requestId === query.requestId)
      && (!query.cartId || entry.cartId === query.cartId)
      && (!query.checkoutId || entry.checkoutId === query.checkoutId)
      && (!query.authorizationId || entry.authorizationId === query.authorizationId);
  }

  private isMissingFile(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error
      && (error as { code?: string }).code === 'ENOENT';
  }
}
