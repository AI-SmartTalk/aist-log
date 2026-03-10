import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3100', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  apiKeys: (process.env.API_KEYS || 'dev-key')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean),

  sqlitePath: process.env.SQLITE_PATH || './data/logserver.db',
  retentionDays: parseInt(process.env.RETENTION_DAYS || '30', 10),

  logFilePath: process.env.LOG_FILE_PATH || './logs/structured.log',
  filePollIntervalMs: parseInt(process.env.FILE_POLL_INTERVAL_MS || '1000', 10),

  openaiApiKey: process.env.OPENAI_API_KEY || '',
  aiModel: process.env.AI_MODEL || 'gpt-4o-mini',

  corsOrigins: (process.env.CORS_ORIGINS || '*')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean),

  kumaApiUrl: process.env.KUMA_API_URL || '',
  kumaApiKey: process.env.KUMA_API_KEY || '',

  get uiDistPath() {
    return path.join(import.meta.dirname, '..', 'ui', 'dist');
  },
} as const;
