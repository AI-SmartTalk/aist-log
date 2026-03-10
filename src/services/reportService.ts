import { getDb } from '../storage/sqlite.js';
import { config } from '../config.js';
import type {
  LogEntry,
  ErrorCluster,
  ReportData,
  KumaMonitorStatus,
  KumaHeartbeat,
} from '../sdk/types.js';

export function buildReportData(entries: LogEntry[], kumaStatus: KumaMonitorStatus[]): ReportData {
  const today = new Date().toISOString().split('T')[0];

  const requestIds = new Set<string>();
  const errorEntries: LogEntry[] = [];
  const warnEntries: LogEntry[] = [];
  const durations: number[] = [];
  const pathDurations = new Map<string, number[]>();
  const pathErrors = new Map<string, { count: number; statusCodes: Set<number> }>();
  const statusCodes: Record<string, number> = {};
  const requestsPerHour: Record<number, number> = {};
  const errorsPerHour: Record<number, number> = {};
  const uniqueUsers = new Set<string>();
  const uniqueIPs = new Set<string>();
  const errorMessages = new Map<string, {
    count: number; paths: Set<string>; firstSeen: string; lastSeen: string;
    sample: LogEntry; chatModelIds: Set<string>; userIds: Set<string>;
    organizationIds: Set<string>; ips: Set<string>; statusCodes: Set<number>; methods: Set<string>;
  }>();

  for (const entry of entries) {
    if (entry.requestId) requestIds.add(entry.requestId);
    if (entry.userId) uniqueUsers.add(entry.userId);
    if (entry.ip) uniqueIPs.add(entry.ip as string);

    const hour = new Date(entry.time).getHours();

    if (entry.msg === 'request completed') {
      requestsPerHour[hour] = (requestsPerHour[hour] || 0) + 1;

      if (entry.duration != null) {
        durations.push(entry.duration);
        const path = entry.path?.split('?')[0] || 'unknown';
        if (!pathDurations.has(path)) pathDurations.set(path, []);
        pathDurations.get(path)!.push(entry.duration);
      }

      if (entry.statusCode) {
        const bucket = `${Math.floor(entry.statusCode / 100)}xx`;
        statusCodes[bucket] = (statusCodes[bucket] || 0) + 1;
        statusCodes[String(entry.statusCode)] = (statusCodes[String(entry.statusCode)] || 0) + 1;
      }
    }

    if (entry.level === 'error' || entry.level === 'fatal') {
      errorEntries.push(entry);
      errorsPerHour[hour] = (errorsPerHour[hour] || 0) + 1;

      const path = entry.path?.split('?')[0] || 'unknown';
      if (!pathErrors.has(path)) pathErrors.set(path, { count: 0, statusCodes: new Set() });
      const pe = pathErrors.get(path)!;
      pe.count++;
      if (entry.statusCode) pe.statusCodes.add(entry.statusCode);

      const errMsg = entry.err?.message || entry.msg || 'Unknown error';
      const key = errMsg.slice(0, 200);
      if (!errorMessages.has(key)) {
        errorMessages.set(key, {
          count: 0, paths: new Set(), firstSeen: entry.time, lastSeen: entry.time,
          sample: entry, chatModelIds: new Set(), userIds: new Set(),
          organizationIds: new Set(), ips: new Set(), statusCodes: new Set(), methods: new Set(),
        });
      }
      const cluster = errorMessages.get(key)!;
      cluster.count++;
      cluster.paths.add(path);
      if (entry.chatModelId) cluster.chatModelIds.add(entry.chatModelId);
      if (entry.userId) cluster.userIds.add(entry.userId);
      if (entry.organizationId) cluster.organizationIds.add(entry.organizationId);
      if (entry.ip) cluster.ips.add(entry.ip as string);
      if (entry.statusCode) cluster.statusCodes.add(entry.statusCode);
      if (entry.method) cluster.methods.add(entry.method);
      if (entry.time < cluster.firstSeen) cluster.firstSeen = entry.time;
      if (entry.time > cluster.lastSeen) cluster.lastSeen = entry.time;
    }

    if (entry.level === 'warn') {
      warnEntries.push(entry);
    }
  }

  durations.sort((a, b) => a - b);
  const avgResponseTime = durations.length > 0
    ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : 0;
  const p95ResponseTime = durations.length > 0
    ? durations[Math.floor(durations.length * 0.95)] || 0 : 0;
  const p99ResponseTime = durations.length > 0
    ? durations[Math.floor(durations.length * 0.99)] || 0 : 0;

  const slowestEndpoints = Array.from(pathDurations.entries())
    .map(([path, durs]) => ({
      path,
      avgDuration: Math.round(durs.reduce((s, d) => s + d, 0) / durs.length),
      count: durs.length,
    }))
    .sort((a, b) => b.avgDuration - a.avgDuration)
    .slice(0, 10);

  const topErrorPaths = Array.from(pathErrors.entries())
    .map(([path, data]) => ({
      path,
      count: data.count,
      statusCodes: Array.from(data.statusCodes),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const errorClusters: ErrorCluster[] = Array.from(errorMessages.entries())
    .map(([message, data]) => ({
      message,
      count: data.count,
      paths: Array.from(data.paths),
      firstSeen: data.firstSeen,
      lastSeen: data.lastSeen,
      sample: data.sample,
      chatModelIds: Array.from(data.chatModelIds),
      userIds: Array.from(data.userIds),
      organizationIds: Array.from(data.organizationIds),
      ips: Array.from(data.ips),
      statusCodes: Array.from(data.statusCodes),
      methods: Array.from(data.methods),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  const totalRequests = requestIds.size || Object.values(requestsPerHour).reduce((s, n) => s + n, 0);

  return {
    date: today,
    totalRequests,
    totalErrors: errorEntries.length,
    totalWarnings: warnEntries.length,
    errorRate: totalRequests > 0 ? Math.round((errorEntries.length / totalRequests) * 10000) / 100 : 0,
    avgResponseTime,
    p95ResponseTime,
    p99ResponseTime,
    slowestEndpoints,
    topErrorPaths,
    errorClusters,
    statusCodeDistribution: statusCodes,
    requestsPerHour,
    errorsPerHour,
    uniqueUsers: uniqueUsers.size,
    uniqueIPs: uniqueIPs.size,
    kumaStatus,
  };
}

export function getLast24hEntries(source?: string): LogEntry[] {
  const db = getDb();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const conditions = ['timestamp >= ?'];
  const params: unknown[] = [cutoff];

  if (source) {
    conditions.push('source = ?');
    params.push(source);
  }

  const rows = db.prepare(`
    SELECT raw FROM request_logs
    WHERE ${conditions.join(' AND ')}
    ORDER BY timestamp ASC
  `).all(...params) as { raw: string }[];

  return rows.map(r => JSON.parse(r.raw));
}

export async function fetchKumaData(): Promise<KumaMonitorStatus[]> {
  const { kumaApiKey, kumaApiUrl } = config;
  if (!kumaApiKey || !kumaApiUrl) return [];

  try {
    const tryFetch = async (url: string): Promise<Response | null> => {
      for (const authHeader of [kumaApiKey, `Bearer ${kumaApiKey}`]) {
        try {
          const r = await fetch(url, {
            headers: { Authorization: authHeader },
            signal: AbortSignal.timeout(10000),
          });
          if (r.ok) return r;
        } catch { /* try next */ }
      }
      return null;
    };

    let monitorsRes = await tryFetch(`${kumaApiUrl}/api/getMonitorList`);
    if (!monitorsRes) monitorsRes = await tryFetch(`${kumaApiUrl}/api/monitors`);
    if (!monitorsRes) monitorsRes = await tryFetch(`${kumaApiUrl}/api/status-page/heartbeat`);
    if (!monitorsRes) return [];

    const monitorsData = await monitorsRes.json();
    const monitors: Record<string, any> = monitorsData.monitors || monitorsData;
    const results: KumaMonitorStatus[] = [];

    for (const [id, monitor] of Object.entries(monitors)) {
      const m = monitor as any;

      let heartbeats: KumaHeartbeat[] = [];
      try {
        let hbRes = await tryFetch(`${kumaApiUrl}/api/getMonitorBeats/${id}?hours=24`);
        if (!hbRes) hbRes = await tryFetch(`${kumaApiUrl}/api/monitors/${id}/beats?hours=24`);
        if (hbRes) {
          const hbData = await hbRes.json();
          heartbeats = hbData.data || hbData || [];
        }
      } catch { /* continue */ }

      const upBeats = heartbeats.filter(h => h.status === 1);
      const uptime24h = heartbeats.length > 0 ? (upBeats.length / heartbeats.length) * 100 : 0;
      const avgPing = upBeats.length > 0
        ? upBeats.reduce((sum, h) => sum + (h.ping || 0), 0) / upBeats.length : 0;

      const lastBeat = heartbeats[heartbeats.length - 1];
      const currentStatus = !lastBeat
        ? 'unknown' as const
        : lastBeat.status === 1 ? 'up' as const
        : lastBeat.status === 0 ? 'down' as const
        : 'pending' as const;

      const incidents = heartbeats
        .filter(h => h.status === 0)
        .map(h => ({ time: h.time, msg: h.msg, duration: h.duration }));

      results.push({
        monitor: {
          id: parseInt(id),
          name: m.name || m.friendly_name || `Monitor ${id}`,
          url: m.url,
          type: m.type || 'http',
          active: m.active !== false,
          interval: m.interval || 60,
        },
        heartbeats,
        uptime24h,
        avgPing: Math.round(avgPing),
        currentStatus,
        incidents,
      });
    }

    return results;
  } catch (err) {
    console.error('Failed to fetch Kuma data:', err);
    return [];
  }
}

export function buildAIPrompt(data: ReportData): string {
  const kumaSection = data.kumaStatus.length > 0
    ? `\n## Infrastructure Monitoring (Uptime Kuma)\n${data.kumaStatus.map(s =>
        `- **${s.monitor.name}** (${s.monitor.type}${s.monitor.url ? `, ${s.monitor.url}` : ''}):\n` +
        `  Status: ${s.currentStatus.toUpperCase()} | Uptime 24h: ${s.uptime24h.toFixed(2)}% | Avg ping: ${s.avgPing}ms\n` +
        `  ${s.incidents.length > 0 ? `Incidents: ${s.incidents.length} downtime events` : 'No incidents'}\n` +
        `  ${s.incidents.slice(0, 5).map(i => `  - ${i.time}: ${i.msg}`).join('\n')}`
      ).join('\n')}\n` : '';

  const errorClusterSection = data.errorClusters.length > 0
    ? data.errorClusters.map((c, i) => {
        const details: string[] = [];
        details.push(`Message: ${c.message}`);
        details.push(`Occurrences: ${c.count}`);
        details.push(`Paths: ${c.paths.join(', ')}`);
        details.push(`First seen: ${c.firstSeen} | Last seen: ${c.lastSeen}`);
        if (c.methods.length > 0) details.push(`Methods: ${c.methods.join(', ')}`);
        if (c.statusCodes.length > 0) details.push(`Status codes: ${c.statusCodes.join(', ')}`);
        if (c.chatModelIds.length > 0) details.push(`ChatModel IDs: ${c.chatModelIds.join(', ')}`);
        if (c.userIds.length > 0) details.push(`User IDs: ${c.userIds.join(', ')}`);
        if (c.organizationIds.length > 0) details.push(`Organization IDs: ${c.organizationIds.join(', ')}`);
        if (c.ips.length > 0) details.push(`IPs: ${c.ips.slice(0, 10).join(', ')}${c.ips.length > 10 ? ` (+${c.ips.length - 10} autres)` : ''}`);
        if (c.sample.err?.stack) details.push(`Stack trace:\n\`\`\`\n${c.sample.err.stack.slice(0, 800)}\n\`\`\``);
        if (c.sample.duration) details.push(`Duration (sample): ${c.sample.duration}ms`);
        return `### Erreur #${i + 1}\n${details.join('\n')}`;
      }).join('\n\n')
    : 'Aucune erreur detectee.';

  return `Tu es un ingenieur SRE/DevOps senior qui analyse les ERREURS de production des dernieres 24h d'une plateforme SaaS.

Periode: dernieres 24h (${data.date})

## Contexte global
- Requetes totales: ${data.totalRequests} | Erreurs: ${data.totalErrors} (taux: ${data.errorRate}%) | Warnings: ${data.totalWarnings}
- Temps de reponse: avg ${data.avgResponseTime}ms | P95: ${data.p95ResponseTime}ms | P99: ${data.p99ResponseTime}ms

## Erreurs par heure
${Object.entries(data.errorsPerHour).sort(([a], [b]) => Number(a) - Number(b)).map(([h, c]) => `${h}h: ${c} err`).join(' | ') || 'Aucune erreur'}

## Top chemins en erreur
${data.topErrorPaths.map(e => `- ${e.path}: ${e.count} erreurs (codes: ${e.statusCodes.join(', ')})`).join('\n') || 'Aucun'}

## Clusters d'erreurs detailles
${errorClusterSection}

${kumaSection}

---

Genere un rapport de veille d'erreurs structure en francais (markdown riche). Concentre-toi UNIQUEMENT sur les erreurs :

1. **Resume** - Nombre total d'erreurs, gravite globale (score /100), resume en 2-3 phrases
2. **Analyse detaillee de chaque cluster d'erreur** - Pour chaque groupe :
   - Explication technique de la cause probable
   - Quels chatbots (ChatModel IDs), users, organisations sont impactes
   - Frequence et pattern temporel
   - Stack trace analysis si disponible
   - Priorite (P0 critique / P1 haute / P2 moyenne / P3 basse)
   - Action corrective recommandee
3. **Correlations** - Liens entre erreurs, patterns communs
${data.kumaStatus.length > 0 ? '4. **Correlation infra** - Lien entre downtimes Kuma et erreurs applicatives\n5.' : '4.'} **Actions prioritaires** - Top 5 actions classees par urgence et impact

Sois precis, concret et actionnable. Cite les IDs pour faciliter le debug.`;
}
