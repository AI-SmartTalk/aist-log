import type { FastifyInstance } from 'fastify';
import { getGroupedLogs, getTraceByRequestId } from '../services/logQueryService.js';
import { getAuthContext } from './auth.js';
import type { LogFilters } from '../sdk/types.js';

export function registerLogsRoutes(app: FastifyInstance): void {
  app.get('/api/logs', async (request) => {
    const q = request.query as Record<string, string | undefined>;
    const auth = getAuthContext(request);

    // Single request trace mode
    if (q.requestId) {
      return getTraceByRequestId(q.requestId);
    }

    const filters: LogFilters = {
      level: q.level,
      method: q.method,
      search: q.search,
      statusCode: q.statusCode,
      path: q.path,
      chatModelId: q.chatModelId,
      userId: q.userId,
      organizationId: q.organizationId,
      ip: q.ip,
      source: q.source,
      from: q.from,
      to: q.to,
      onlyErrors: q.onlyErrors === 'true',
      minDuration: q.minDuration ? parseInt(q.minDuration, 10) : undefined,
    };

    // Project scoping
    let projectId: string | undefined;
    if (auth.role === 'project') {
      projectId = auth.projectId!;
    } else if (q.projectId) {
      projectId = q.projectId;
    }

    const page = Math.max(1, parseInt(q.page || '1', 10));
    const limit = parseInt(q.limit || '50', 10);

    return getGroupedLogs(filters, page, limit, projectId);
  });
}
