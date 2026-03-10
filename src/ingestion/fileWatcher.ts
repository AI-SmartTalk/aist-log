import { watch } from 'chokidar';
import { createReadStream, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { config } from '../config.js';
import { getDb } from '../storage/sqlite.js';
import type { LogEntry } from '../sdk/types.js';

let isRunning = false;
let isIngesting = false;
let watcherInstance: ReturnType<typeof watch> | null = null;

const insertStmt = () => getDb().prepare(`
  INSERT INTO request_logs (
    timestamp, level, request_id, method, path, status_code, duration_ms,
    user_id, chat_model_id, organization_id, ip, message,
    error_message, error_stack, raw, source
  ) VALUES (
    @timestamp, @level, @request_id, @method, @path, @status_code, @duration_ms,
    @user_id, @chat_model_id, @organization_id, @ip, @message,
    @error_message, @error_stack, @raw, @source
  )
`);

function getFileOffset(): { byteOffset: number; inode: number | null } {
  const row = getDb()
    .prepare('SELECT byte_offset, inode FROM file_offsets WHERE file_path = ?')
    .get(config.logFilePath) as { byte_offset: number; inode: number } | undefined;
  return { byteOffset: row?.byte_offset ?? 0, inode: row?.inode ?? null };
}

function saveFileOffset(byteOffset: number, inode: number): void {
  getDb().prepare(`
    INSERT INTO file_offsets (file_path, byte_offset, inode, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(file_path) DO UPDATE SET
      byte_offset = excluded.byte_offset,
      inode = excluded.inode,
      updated_at = datetime('now')
  `).run(config.logFilePath, byteOffset, inode);
}

async function ingestFromOffset(): Promise<void> {
  if (isIngesting) return;
  isIngesting = true;
  try {
    await doIngest();
  } finally {
    isIngesting = false;
  }
}

async function doIngest(): Promise<void> {
  let stat;
  try {
    stat = statSync(config.logFilePath);
  } catch {
    return; // File doesn't exist yet
  }

  const currentInode = stat.ino;
  const fileSize = stat.size;
  const saved = getFileOffset();

  // Detect file rotation: inode changed or file shrunk
  let startByte = saved.byteOffset;
  if (saved.inode !== null && (saved.inode !== currentInode || fileSize < startByte)) {
    console.log(`[file-watcher] File rotated, restarting from 0`);
    startByte = 0;
  }

  if (startByte >= fileSize) return; // Nothing new

  const stream = createReadStream(config.logFilePath, {
    start: startByte,
    encoding: 'utf8',
  });

  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const batch: Parameters<ReturnType<typeof insertStmt>['run']>[0][] = [];

  for await (const line of rl) {
    if (!line.startsWith('{')) continue;
    try {
      const entry = JSON.parse(line) as LogEntry;
      batch.push({
        timestamp: entry.time || new Date().toISOString(),
        level: entry.level || 'info',
        request_id: entry.requestId || null,
        method: entry.method || null,
        path: entry.path || null,
        status_code: entry.statusCode ?? null,
        duration_ms: entry.duration ?? null,
        user_id: entry.userId || null,
        chat_model_id: entry.chatModelId || null,
        organization_id: entry.organizationId || null,
        ip: entry.ip || null,
        message: entry.msg || null,
        error_message: entry.err?.message || null,
        error_stack: entry.err?.stack || null,
        raw: line,
        source: 'default',
      });
    } catch {
      // Skip malformed lines
    }
  }

  if (batch.length > 0) {
    const stmt = insertStmt();
    const tx = getDb().transaction((rows: typeof batch) => {
      for (const row of rows) {
        stmt.run(row);
      }
    });
    tx(batch);
    console.log(`[file-watcher] Ingested ${batch.length} log entries`);
  }

  // Save new offset
  const newStat = statSync(config.logFilePath);
  saveFileOffset(newStat.size, currentInode);
}

export function startFileWatcher(): void {
  if (isRunning) return;
  isRunning = true;

  console.log(`[file-watcher] Watching ${config.logFilePath}`);

  // Initial ingestion
  ingestFromOffset().catch(err => {
    console.error('[file-watcher] Initial ingestion error:', err);
  });

  // Watch for changes
  watcherInstance = watch(config.logFilePath, {
    persistent: true,
    usePolling: true,
    interval: config.filePollIntervalMs,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 200,
    },
  });

  watcherInstance.on('change', () => {
    ingestFromOffset().catch(err => {
      console.error('[file-watcher] Ingestion error:', err);
    });
  });

  // Handle file recreation after rotation
  watcherInstance.on('add', () => {
    ingestFromOffset().catch(err => {
      console.error('[file-watcher] Ingestion error after file add:', err);
    });
  });
}

export function stopFileWatcher(): void {
  if (watcherInstance) {
    watcherInstance.close();
    watcherInstance = null;
  }
  isRunning = false;
}

export function getFileWatcherStatus(): { active: boolean; filePath: string; byteOffset: number } {
  const { byteOffset } = getFileOffset();
  return {
    active: isRunning,
    filePath: config.logFilePath,
    byteOffset,
  };
}
