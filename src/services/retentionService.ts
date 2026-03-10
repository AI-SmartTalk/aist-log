import { getDb } from '../storage/sqlite.js';
import { config } from '../config.js';

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startRetentionService(): void {
  if (intervalHandle) return;

  // Run once on startup, then every 6 hours
  purgeOldLogs();
  intervalHandle = setInterval(purgeOldLogs, 6 * 60 * 60 * 1000);

  console.log(`[retention] Started — purging logs older than ${config.retentionDays} days, every 6h`);
}

export function stopRetentionService(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

function purgeOldLogs(): void {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - config.retentionDays * 24 * 60 * 60 * 1000).toISOString();

    const r1 = db.prepare('DELETE FROM request_logs WHERE timestamp < ?').run(cutoff);
    const r2 = db.prepare('DELETE FROM audit_logs WHERE timestamp < ?').run(cutoff);

    const totalDeleted = r1.changes + r2.changes;
    if (totalDeleted > 0) {
      console.log(`[retention] Purged ${totalDeleted} logs older than ${config.retentionDays}d`);
      // Reclaim disk space periodically
      db.pragma('incremental_vacuum');
    }
  } catch (err) {
    console.error('[retention] Purge error:', err);
  }
}
