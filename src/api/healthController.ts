import type { FastifyInstance } from 'fastify';
import { statSync } from 'node:fs';
import { getDb } from '../storage/sqlite.js';
import { getFileWatcherStatus } from '../ingestion/fileWatcher.js';
import { config } from '../config.js';

const startTime = Date.now();

export function registerHealthRoutes(app: FastifyInstance): void {
  // Health check — no auth required
  app.get('/api/health', { config: { skipAuth: true } }, async () => {
    const db = getDb();

    const requestLogsCount = (db.prepare('SELECT COUNT(*) as cnt FROM request_logs').get() as any).cnt;
    const auditLogsCount = (db.prepare('SELECT COUNT(*) as cnt FROM audit_logs').get() as any).cnt;

    const lastIngestion = (db.prepare(`
      SELECT MAX(ingested_at) as last FROM request_logs
    `).get() as any)?.last || null;

    let dbSizeBytes = 0;
    try {
      dbSizeBytes = statSync(config.sqlitePath).size;
    } catch { /* file may not exist yet */ }

    const fileWatcher = getFileWatcherStatus();

    return {
      status: 'ok' as const,
      uptime: Math.round((Date.now() - startTime) / 1000),
      dbSizeBytes,
      requestLogsCount,
      auditLogsCount,
      lastIngestion,
      fileWatcher,
      retentionDays: config.retentionDays,
    };
  });
}
