import { getDb } from '../storage/sqlite.js';
import type {
  LogEntry,
  RequestGroup,
  LogFilters,
  GroupedLogsResponse,
  TraceLogsResponse,
} from '../sdk/types.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function getTraceByRequestId(requestId: string): TraceLogsResponse {
  const db = getDb();
  const rows = db.prepare(`
    SELECT raw FROM request_logs
    WHERE request_id = ?
    ORDER BY timestamp ASC
  `).all(requestId) as { raw: string }[];

  const entries: LogEntry[] = rows.map(r => JSON.parse(r.raw));

  return {
    mode: 'trace',
    requestId,
    entries,
    total: entries.length,
  };
}

export function getGroupedLogs(
  filters: LogFilters,
  page: number = 1,
  limit: number = DEFAULT_LIMIT,
  projectId?: string,
): GroupedLogsResponse {
  limit = Math.min(MAX_LIMIT, Math.max(1, limit));
  page = Math.max(1, page);

  const db = getDb();

  // Build WHERE clauses for pre-filtering at DB level
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (projectId) {
    conditions.push('project_id = @projectId');
    params.projectId = projectId;
  } else if (filters.source) {
    conditions.push('source = @source');
    params.source = filters.source;
  }
  if (filters.level) {
    conditions.push('level = @level');
    params.level = filters.level;
  }
  if (filters.method) {
    conditions.push('method = @method');
    params.method = filters.method;
  }
  if (filters.path) {
    conditions.push('path LIKE @path');
    params.path = `%${filters.path}%`;
  }
  if (filters.userId) {
    conditions.push('user_id LIKE @userId');
    params.userId = `%${filters.userId}%`;
  }
  if (filters.chatModelId) {
    conditions.push('chat_model_id LIKE @chatModelId');
    params.chatModelId = `%${filters.chatModelId}%`;
  }
  if (filters.organizationId) {
    conditions.push('organization_id LIKE @organizationId');
    params.organizationId = `%${filters.organizationId}%`;
  }
  if (filters.ip) {
    conditions.push('ip LIKE @ip');
    params.ip = `%${filters.ip}%`;
  }
  if (filters.from) {
    conditions.push('timestamp >= @from');
    params.from = filters.from;
  }
  if (filters.to) {
    conditions.push('timestamp <= @to');
    params.to = filters.to;
  }
  if (filters.onlyErrors) {
    conditions.push("level IN ('error', 'fatal')");
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get all matching entries (limit to recent 10K rows for performance)
  const rows = db.prepare(`
    SELECT raw FROM request_logs
    ${whereClause}
    ORDER BY timestamp DESC
    LIMIT 10000
  `).all(params) as { raw: string }[];

  const entries: LogEntry[] = rows.map(r => JSON.parse(r.raw));
  const groups = buildGroups(entries);

  // Apply post-filtering that requires group-level logic
  const filtered = groups.filter(g => matchesGroupFilters(g, filters));
  const total = filtered.length;
  const pages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const paged = filtered.slice(start, start + limit);

  return {
    mode: 'grouped',
    groups: paged,
    total,
    page,
    pages,
  };
}

function buildGroups(entries: LogEntry[]): RequestGroup[] {
  const map = new Map<string, LogEntry[]>();

  for (const entry of entries) {
    if (entry.requestId) {
      let list = map.get(entry.requestId);
      if (!list) {
        list = [];
        map.set(entry.requestId, list);
      }
      list.push(entry);
    }
  }

  const groups: RequestGroup[] = [];

  for (const [requestId, groupEntries] of map) {
    groupEntries.sort((a, b) => a.time.localeCompare(b.time));

    const started = groupEntries.find(e => e.msg === 'request started');
    const completed = groupEntries.find(e => e.msg === 'request completed');
    const withUser = groupEntries.find(e => e.userId);
    const withModel = groupEntries.find(e => e.chatModelId);

    groups.push({
      requestId,
      method: started?.method || completed?.method || '',
      path: started?.path || completed?.path || '',
      statusCode: completed?.statusCode ?? null,
      duration: completed?.duration ?? null,
      userId: (withUser?.userId as string) ?? null,
      chatModelId: (withModel?.chatModelId as string) ?? null,
      organizationId: (withModel?.organizationId as string) ?? null,
      ip: (started?.ip as string) ?? null,
      startTime: groupEntries[0].time,
      endTime: groupEntries[groupEntries.length - 1].time,
      logCount: groupEntries.length,
      hasError: groupEntries.some(e => e.level === 'error' || e.level === 'fatal'),
      entries: groupEntries,
    });
  }

  groups.sort((a, b) => b.startTime.localeCompare(a.startTime));
  return groups;
}

function matchesGroupFilters(group: RequestGroup, filters: LogFilters): boolean {
  if (filters.onlyErrors && !group.hasError) return false;

  if (filters.statusCode) {
    if (filters.statusCode.endsWith('xx')) {
      const prefix = parseInt(filters.statusCode[0], 10);
      if (!isNaN(prefix)) {
        const min = prefix * 100;
        const max = min + 99;
        if (group.statusCode == null || group.statusCode < min || group.statusCode > max) return false;
      }
    } else {
      const sc = parseInt(filters.statusCode, 10);
      if (!isNaN(sc) && group.statusCode !== sc) return false;
    }
  }

  if (filters.minDuration != null && (group.duration == null || group.duration < filters.minDuration)) return false;

  if (filters.search) {
    const q = filters.search.toLowerCase();
    const haystack = group.entries
      .map(e => `${e.msg} ${e.path || ''} ${e.requestId || ''} ${e.userId || ''} ${e.chatModelId || ''} ${e.organizationId || ''} ${e.ip || ''}`)
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  return true;
}
