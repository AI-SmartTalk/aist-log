import type { FastifyInstance } from 'fastify';
import { getDb } from '../storage/sqlite.js';

export function registerSourcesRoutes(app: FastifyInstance): void {
  /** List all distinct sources with counts and last activity */
  app.get('/api/sources', async () => {
    const db = getDb();

    const auditSources = db.prepare(`
      SELECT source, COUNT(*) as cnt, MAX(timestamp) as last_ts
      FROM audit_logs GROUP BY source
    `).all() as { source: string; cnt: number; last_ts: string }[];

    const requestSources = db.prepare(`
      SELECT source, COUNT(*) as cnt, MAX(timestamp) as last_ts
      FROM request_logs GROUP BY source
    `).all() as { source: string; cnt: number; last_ts: string }[];

    // Merge sources from both tables
    const map = new Map<string, { source: string; auditCount: number; requestCount: number; lastActivity: string | null }>();

    for (const r of auditSources) {
      const existing = map.get(r.source);
      if (existing) {
        existing.auditCount = r.cnt;
        if (r.last_ts && (!existing.lastActivity || r.last_ts > existing.lastActivity)) {
          existing.lastActivity = r.last_ts;
        }
      } else {
        map.set(r.source, { source: r.source, auditCount: r.cnt, requestCount: 0, lastActivity: r.last_ts });
      }
    }

    for (const r of requestSources) {
      const existing = map.get(r.source);
      if (existing) {
        existing.requestCount = r.cnt;
        if (r.last_ts && (!existing.lastActivity || r.last_ts > existing.lastActivity)) {
          existing.lastActivity = r.last_ts;
        }
      } else {
        map.set(r.source, { source: r.source, auditCount: 0, requestCount: r.cnt, lastActivity: r.last_ts });
      }
    }

    return {
      sources: Array.from(map.values()).sort((a, b) => {
        const aLast = a.lastActivity || '';
        const bLast = b.lastActivity || '';
        return bLast.localeCompare(aLast);
      }),
    };
  });

  /** Get tag keys used by a source (for dynamic filter UI) */
  app.get('/api/sources/:source/tag-keys', async (request) => {
    const { source } = request.params as { source: string };
    const db = getDb();

    // Sample recent 1000 rows and extract distinct tag keys
    const rows = db.prepare(`
      SELECT DISTINCT tags FROM audit_logs
      WHERE source = ? AND tags IS NOT NULL AND tags != '{}'
      ORDER BY timestamp DESC LIMIT 1000
    `).all(source) as { tags: string }[];

    const keys = new Set<string>();
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.tags);
        for (const key of Object.keys(parsed)) {
          keys.add(key);
        }
      } catch { /* skip invalid json */ }
    }

    return { tagKeys: Array.from(keys).sort() };
  });
}
