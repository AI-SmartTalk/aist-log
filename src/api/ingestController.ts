import type { FastifyInstance } from 'fastify';
import { getDb } from '../storage/sqlite.js';
import { getAuthContext } from './auth.js';
import type { IngestPayload } from '../sdk/types.js';

/**
 * Extract tag filter conditions from query params.
 * Query params like `tag.chatModelId=abc` become json_extract(tags, '$.chatModelId') = 'abc'
 */
function extractTagFilters(query: Record<string, string | undefined>): { conditions: string[]; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith('tag.') && value) {
      const tagKey = key.slice(4);
      conditions.push(`json_extract(tags, '$.${tagKey}') = ?`);
      params.push(value);
    }
  }
  return { conditions, params };
}

export function registerIngestRoutes(app: FastifyInstance): void {
  app.post('/api/ingest', async (request, reply) => {
    const body = request.body as IngestPayload;
    const auth = getAuthContext(request);

    if (!Array.isArray(body?.logs) || body.logs.length === 0) {
      return reply.code(400).send({ error: 'Invalid payload: { logs[] } required' });
    }

    if (body.logs.length > 1000) {
      return reply.code(400).send({ error: 'Max 1000 logs per batch' });
    }

    // Resolve project_id: from auth context or legacy source field
    let projectId = auth.projectId;
    const source = body.source || auth.projectSlug || 'default';

    // If admin key with source, try to find matching project
    if (!projectId && body.source) {
      const db = getDb();
      const proj = db.prepare('SELECT id FROM projects WHERE slug = ?').get(body.source) as { id: string } | undefined;
      if (proj) projectId = proj.id;
    }

    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO audit_logs (timestamp, log_type, status, details, error_message, user_id, entity_id, tags, source, project_id)
      VALUES (@timestamp, @log_type, @status, @details, @error_message, @user_id, @entity_id, @tags, @source, @project_id)
    `);

    const tx = db.transaction((logs: typeof body.logs) => {
      for (const log of logs) {
        // Build tags: merge explicit tags with legacy entityId
        const tags: Record<string, string> = { ...(log.tags || {}) };
        if (log.entityId && !tags.entityId) {
          tags.entityId = log.entityId;
        }

        stmt.run({
          timestamp: log.timestamp || new Date().toISOString(),
          log_type: log.type,
          status: log.status || 'SUCCESS',
          details: log.details ? JSON.stringify(log.details) : null,
          error_message: log.errorMessage || null,
          user_id: log.userId || null,
          entity_id: log.entityId || null,
          tags: JSON.stringify(tags),
          source,
          project_id: projectId,
        });
      }
    });

    tx(body.logs);

    return { ingested: body.logs.length, source, projectId };
  });

  // Get audit logs with filtering (supports tag.* filters, project-scoped)
  app.get('/api/audit/logs', async (request) => {
    const q = request.query as Record<string, string | undefined>;
    const auth = getAuthContext(request);
    const db = getDb();

    const conditions: string[] = [];
    const params: unknown[] = [];

    // Project scoping: project keys can only see their own logs
    if (auth.role === 'project') {
      conditions.push('project_id = ?'); params.push(auth.projectId);
    } else if (q.projectId) {
      conditions.push('project_id = ?'); params.push(q.projectId);
    } else if (q.source) {
      conditions.push('source = ?'); params.push(q.source);
    }

    // Support comma-separated logType values
    if (q.logType) {
      const types = q.logType.split(',').map(s => s.trim()).filter(Boolean);
      if (types.length === 1) {
        conditions.push('log_type = ?'); params.push(types[0]);
      } else if (types.length > 1) {
        conditions.push(`log_type IN (${types.map(() => '?').join(',')})`);
        params.push(...types);
      }
    }

    // Support comma-separated status values
    if (q.status) {
      const statuses = q.status.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        conditions.push('status = ?'); params.push(statuses[0]);
      } else if (statuses.length > 1) {
        conditions.push(`status IN (${statuses.map(() => '?').join(',')})`);
        params.push(...statuses);
      }
    }

    if (q.userId) { conditions.push('user_id LIKE ?'); params.push(`%${q.userId}%`); }

    // Legacy entityId filter
    if (q.entityId) { conditions.push("json_extract(tags, '$.entityId') = ?"); params.push(q.entityId); }

    // Generic tag filters: tag.keyName=value
    const tagFilters = extractTagFilters(q);
    conditions.push(...tagFilters.conditions);
    params.push(...tagFilters.params);

    if (q.from) { conditions.push('timestamp >= ?'); params.push(q.from); }
    if (q.to) { conditions.push('timestamp <= ?'); params.push(q.to); }

    // Full-text search
    if (q.search) {
      conditions.push("(log_type LIKE ? OR error_message LIKE ? OR details LIKE ? OR tags LIKE ?)");
      const term = `%${q.search}%`;
      params.push(term, term, term, term);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const page = Math.max(1, parseInt(q.page || '1', 10));
    const limit = Math.min(5000, Math.max(1, parseInt(q.limit || '50', 10)));
    const offset = (page - 1) * limit;

    const total = (db.prepare(`SELECT COUNT(*) as cnt FROM audit_logs ${where}`).get(...params) as any).cnt;
    const logs = db.prepare(`
      SELECT * FROM audit_logs ${where}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return { logs, total, page, pages: Math.ceil(total / limit) };
  });
}
