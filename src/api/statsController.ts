import type { FastifyInstance } from 'fastify';
import { getDb } from '../storage/sqlite.js';
import { getAuthContext } from './auth.js';

function extractTagFilters(query: Record<string, string | undefined>): { conditions: string[]; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith('tag.') && value) {
      conditions.push(`json_extract(tags, '$.${key.slice(4)}') = ?`);
      params.push(value);
    }
  }
  return { conditions, params };
}

export function registerStatsRoutes(app: FastifyInstance): void {
  // Request logs stats
  app.get('/api/logs/stats', async (request) => {
    const q = request.query as Record<string, string | undefined>;
    const auth = getAuthContext(request);
    const db = getDb();

    const timeRange = q.timeRange || '24h';
    const hours = timeRange === '7d' ? 168 : timeRange === '30d' ? 720 : 24;
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const conditions = ['timestamp >= ?'];
    const params: unknown[] = [cutoff];

    if (auth.role === 'project') {
      conditions.push('project_id = ?'); params.push(auth.projectId);
    } else if (q.projectId) {
      conditions.push('project_id = ?'); params.push(q.projectId);
    } else if (q.source) {
      conditions.push('source = ?'); params.push(q.source);
    }
    const where = conditions.join(' AND ');

    const totalRequests = (db.prepare(`SELECT COUNT(DISTINCT request_id) as cnt FROM request_logs WHERE ${where} AND request_id IS NOT NULL`).get(...params) as any).cnt;
    const totalErrors = (db.prepare(`SELECT COUNT(*) as cnt FROM request_logs WHERE ${where} AND level IN ('error', 'fatal')`).get(...params) as any).cnt;
    const avgDuration = (db.prepare(`SELECT AVG(duration_ms) as avg FROM request_logs WHERE ${where} AND duration_ms IS NOT NULL`).get(...params) as any).avg || 0;

    const statusDistribution = db.prepare(`SELECT status_code, COUNT(*) as cnt FROM request_logs WHERE ${where} AND status_code IS NOT NULL GROUP BY status_code ORDER BY cnt DESC`).all(...params) as { status_code: number; cnt: number }[];
    const levelDistribution = db.prepare(`SELECT level, COUNT(*) as cnt FROM request_logs WHERE ${where} GROUP BY level ORDER BY cnt DESC`).all(...params) as { level: string; cnt: number }[];
    const topPaths = db.prepare(`SELECT path, COUNT(*) as cnt, AVG(duration_ms) as avg_duration FROM request_logs WHERE ${where} AND path IS NOT NULL GROUP BY path ORDER BY cnt DESC LIMIT 20`).all(...params) as { path: string; cnt: number; avg_duration: number }[];

    return {
      totalRequests, totalErrors,
      errorRate: totalRequests > 0 ? Math.round((totalErrors / totalRequests) * 10000) / 100 : 0,
      avgResponseTime: Math.round(avgDuration),
      statusDistribution: Object.fromEntries(statusDistribution.map(r => [r.status_code, r.cnt])),
      levelDistribution: Object.fromEntries(levelDistribution.map(r => [r.level, r.cnt])),
      topPaths: topPaths.map(r => ({ path: r.path, count: r.cnt, avgDuration: Math.round(r.avg_duration || 0) })),
      timeRange,
    };
  });

  // Audit logs stats (project-scoped, supports tag.* filters)
  app.get('/api/audit/stats', async (request) => {
    const q = request.query as Record<string, string | undefined>;
    const auth = getAuthContext(request);
    const db = getDb();

    let fromDate: string;
    let toDate: string | undefined;
    if (q.from) {
      fromDate = q.from;
      toDate = q.to;
    } else {
      const timeRange = q.timeRange || '24h';
      const hours = timeRange === '7d' ? 168 : timeRange === '30d' ? 720 : 24;
      fromDate = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    }

    const conditions = ['timestamp >= ?'];
    const params: unknown[] = [fromDate];
    if (toDate) { conditions.push('timestamp <= ?'); params.push(toDate); }

    if (auth.role === 'project') {
      conditions.push('project_id = ?'); params.push(auth.projectId);
    } else if (q.projectId) {
      conditions.push('project_id = ?'); params.push(q.projectId);
    } else if (q.source) {
      conditions.push('source = ?'); params.push(q.source);
    }

    if (q.entityId) { conditions.push("json_extract(tags, '$.entityId') = ?"); params.push(q.entityId); }

    const tagFilters = extractTagFilters(q);
    conditions.push(...tagFilters.conditions);
    params.push(...tagFilters.params);

    const where = conditions.join(' AND ');

    const totalLogs = (db.prepare(`SELECT COUNT(*) as cnt FROM audit_logs WHERE ${where}`).get(...params) as any).cnt;
    const byType = db.prepare(`SELECT log_type, COUNT(*) as cnt FROM audit_logs WHERE ${where} GROUP BY log_type ORDER BY cnt DESC`).all(...params) as { log_type: string; cnt: number }[];
    const byStatus = db.prepare(`SELECT status, COUNT(*) as cnt FROM audit_logs WHERE ${where} GROUP BY status ORDER BY cnt DESC`).all(...params) as { status: string; cnt: number }[];
    const timeDist = db.prepare(`SELECT DATE(timestamp) as dt, COUNT(*) as cnt FROM audit_logs WHERE ${where} GROUP BY DATE(timestamp) ORDER BY dt ASC`).all(...params) as { dt: string; cnt: number }[];

    return {
      totalLogs,
      byType: Object.fromEntries(byType.map(r => [r.log_type, r.cnt])),
      byStatus: Object.fromEntries(byStatus.map(r => [r.status, r.cnt])),
      timeDistribution: { labels: timeDist.map(r => r.dt), data: timeDist.map(r => r.cnt) },
    };
  });
}
