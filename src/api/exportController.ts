import type { FastifyInstance } from 'fastify';
import { getDb } from '../storage/sqlite.js';

export function registerExportRoutes(app: FastifyInstance): void {
  // Export request logs as CSV
  app.get('/api/logs/export', async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const db = getDb();

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (q.from) { conditions.push('timestamp >= ?'); params.push(q.from); }
    if (q.to) { conditions.push('timestamp <= ?'); params.push(q.to); }
    if (q.source) { conditions.push('source = ?'); params.push(q.source); }
    if (q.level) { conditions.push('level = ?'); params.push(q.level); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = db.prepare(`
      SELECT timestamp, level, request_id, method, path, status_code,
             duration_ms, user_id, chat_model_id, organization_id, ip,
             message, error_message, source
      FROM request_logs ${where}
      ORDER BY timestamp DESC
      LIMIT 50000
    `).all(...params) as Record<string, unknown>[];

    const headers = [
      'timestamp', 'level', 'request_id', 'method', 'path', 'status_code',
      'duration_ms', 'user_id', 'chat_model_id', 'organization_id', 'ip',
      'message', 'error_message', 'source',
    ];

    const csvLines = [headers.join(',')];
    for (const row of rows) {
      csvLines.push(
        headers.map(h => {
          const val = row[h];
          if (val == null) return '';
          const str = String(val);
          return str.includes(',') || str.includes('"') || str.includes('\n')
            ? `"${str.replace(/"/g, '""')}"` : str;
        }).join(',')
      );
    }

    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="logs-export-${new Date().toISOString().split('T')[0]}.csv"`)
      .send(csvLines.join('\n'));
  });

  // Export audit logs as CSV
  app.get('/api/audit/export', async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const db = getDb();

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (q.from) { conditions.push('timestamp >= ?'); params.push(q.from); }
    if (q.to) { conditions.push('timestamp <= ?'); params.push(q.to); }
    if (q.source) { conditions.push('source = ?'); params.push(q.source); }
    if (q.logType) { conditions.push('log_type = ?'); params.push(q.logType); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = db.prepare(`
      SELECT timestamp, log_type, status, details, error_message,
             user_id, entity_id, source
      FROM audit_logs ${where}
      ORDER BY timestamp DESC
      LIMIT 50000
    `).all(...params) as Record<string, unknown>[];

    const headers = ['timestamp', 'log_type', 'status', 'details', 'error_message', 'user_id', 'entity_id', 'tags', 'source'];

    const csvLines = [headers.join(',')];
    for (const row of rows) {
      csvLines.push(
        headers.map(h => {
          const val = row[h];
          if (val == null) return '';
          const str = String(val);
          return str.includes(',') || str.includes('"') || str.includes('\n')
            ? `"${str.replace(/"/g, '""')}"` : str;
        }).join(',')
      );
    }

    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="audit-export-${new Date().toISOString().split('T')[0]}.csv"`)
      .send(csvLines.join('\n'));
  });
}
