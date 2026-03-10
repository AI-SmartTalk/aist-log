import type { AuditLog, IngestPayload } from './types.js';

interface LogServerClientOptions {
  url: string;
  apiKey: string;
  source: string;
  /** Default tags applied to every log entry */
  defaultTags?: Record<string, string>;
  batchSize?: number;
  flushIntervalMs?: number;
  onError?: (error: Error) => void;
}

export class LogServerClient {
  private url: string;
  private apiKey: string;
  private source: string;
  private defaultTags: Record<string, string>;
  private batchSize: number;
  private flushIntervalMs: number;
  private onError: (error: Error) => void;
  private buffer: AuditLog[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isFlushing = false;

  constructor(options: LogServerClientOptions) {
    this.url = options.url.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.source = options.source;
    this.defaultTags = options.defaultTags ?? {};
    this.batchSize = options.batchSize ?? 50;
    this.flushIntervalMs = options.flushIntervalMs ?? 5000;
    this.onError = options.onError ?? ((err) => console.error('[LogServerClient]', err.message));

    this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
  }

  async log(entry: Omit<AuditLog, 'timestamp'> & { timestamp?: string }): Promise<void> {
    // Merge default tags with per-entry tags
    const tags = { ...this.defaultTags, ...(entry.tags || {}) };
    // Backward compat: entityId → tags.entityId
    if (entry.entityId && !tags.entityId) {
      tags.entityId = entry.entityId;
    }

    this.buffer.push({
      ...entry,
      tags,
      timestamp: entry.timestamp || new Date().toISOString(),
    });

    if (this.buffer.length >= this.batchSize) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.isFlushing || this.buffer.length === 0) return;

    this.isFlushing = true;
    const batch = this.buffer.splice(0, this.batchSize);

    try {
      const payload: IngestPayload = {
        source: this.source,
        logs: batch,
      };

      const response = await fetch(`${this.url}/api/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        // Put logs back in buffer for retry
        this.buffer.unshift(...batch);
        throw new Error(`Ingest failed: ${response.status} ${response.statusText}`);
      }
    } catch (err) {
      // Put logs back in buffer for retry (if not already done)
      if (!this.buffer.includes(batch[0])) {
        this.buffer.unshift(...batch);
      }
      // Trim buffer to prevent memory leak (max 10K pending logs)
      if (this.buffer.length > 10000) {
        this.buffer = this.buffer.slice(-10000);
      }
      this.onError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.isFlushing = false;
    }
  }

  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Final flush
    await this.flush();
  }

  get pendingCount(): number {
    return this.buffer.length;
  }
}
