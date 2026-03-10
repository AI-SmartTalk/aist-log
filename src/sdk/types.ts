// ---------------------------------------------------------------------------
// Shared types between server, SDK client, and UI
// ---------------------------------------------------------------------------

export interface LogEntry {
  level: string;
  time: string;
  msg: string;
  requestId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  duration?: number;
  userId?: string;
  chatModelId?: string;
  organizationId?: string;
  ip?: string;
  userAgent?: string;
  pmId?: number;
  err?: { message: string; stack: string };
  [key: string]: unknown;
}

export interface RequestGroup {
  requestId: string;
  method: string;
  path: string;
  statusCode: number | null;
  duration: number | null;
  userId: string | null;
  chatModelId: string | null;
  organizationId: string | null;
  ip: string | null;
  startTime: string;
  endTime: string;
  logCount: number;
  hasError: boolean;
  entries: LogEntry[];
}

export interface AuditLog {
  type: string;
  status: string;
  details?: Record<string, unknown>;
  errorMessage?: string;
  userId?: string;
  /** @deprecated Use tags instead */
  entityId?: string;
  /** Generic key-value metadata for filtering (e.g. { chatModelId, organisationId }) */
  tags?: Record<string, string>;
  timestamp?: string;
}

export interface IngestPayload {
  source: string;
  logs: AuditLog[];
}

export interface LogFilters {
  level?: string;
  method?: string;
  search?: string;
  minDuration?: number;
  statusCode?: string;
  path?: string;
  chatModelId?: string;
  userId?: string;
  organizationId?: string;
  ip?: string;
  onlyErrors?: boolean;
  source?: string;
  from?: string;
  to?: string;
}

export interface GroupedLogsResponse {
  mode: 'grouped';
  groups: RequestGroup[];
  total: number;
  page: number;
  pages: number;
}

export interface TraceLogsResponse {
  mode: 'trace';
  requestId: string;
  entries: LogEntry[];
  total: number;
}

export interface ErrorCluster {
  message: string;
  count: number;
  paths: string[];
  firstSeen: string;
  lastSeen: string;
  sample: LogEntry;
  chatModelIds: string[];
  userIds: string[];
  organizationIds: string[];
  ips: string[];
  statusCodes: number[];
  methods: string[];
}

export interface ReportData {
  date: string;
  totalRequests: number;
  totalErrors: number;
  totalWarnings: number;
  errorRate: number;
  avgResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  slowestEndpoints: { path: string; avgDuration: number; count: number }[];
  topErrorPaths: { path: string; count: number; statusCodes: number[] }[];
  errorClusters: ErrorCluster[];
  statusCodeDistribution: Record<string, number>;
  requestsPerHour: Record<number, number>;
  errorsPerHour: Record<number, number>;
  uniqueUsers: number;
  uniqueIPs: number;
  kumaStatus: KumaMonitorStatus[];
}

export interface KumaMonitor {
  id: number;
  name: string;
  url?: string;
  type: string;
  active: boolean;
  interval: number;
}

export interface KumaHeartbeat {
  status: number;
  time: string;
  msg: string;
  ping: number;
  duration?: number;
}

export interface KumaMonitorStatus {
  monitor: KumaMonitor;
  heartbeats: KumaHeartbeat[];
  uptime24h: number;
  avgPing: number;
  currentStatus: 'up' | 'down' | 'pending' | 'unknown';
  incidents: { time: string; msg: string; duration?: number }[];
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  uptime: number;
  dbSizeBytes: number;
  requestLogsCount: number;
  auditLogsCount: number;
  lastIngestion: string | null;
  fileWatcher: {
    active: boolean;
    filePath: string;
    byteOffset: number;
  };
  retentionDays: number;
}

export interface AuditLogRow {
  id: number;
  timestamp: string;
  log_type: string;
  status: string;
  details: string | null;
  error_message: string | null;
  user_id: string | null;
  entity_id: string | null;
  tags: string | null;
  source: string;
  ingested_at: string;
}

export interface AuditLogsResponse {
  logs: AuditLogRow[];
  total: number;
  page: number;
  pages: number;
}

export interface AuditStatsResponse {
  totalLogs: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  timeDistribution: { labels: string[]; data: number[] };
}

export interface SourceInfo {
  source: string;
  auditCount: number;
  requestCount: number;
  lastActivity: string | null;
}
