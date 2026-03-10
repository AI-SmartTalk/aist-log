import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import fastifyCompress from '@fastify/compress';
import fastifyRateLimit from '@fastify/rate-limit';
import { existsSync } from 'node:fs';
import { config } from './config.js';
import { initDb, closeDb } from './storage/sqlite.js';
import { registerRoutes } from './api/routes.js';
import { startFileWatcher, stopFileWatcher } from './ingestion/fileWatcher.js';
import { startRetentionService, stopRetentionService } from './services/retentionService.js';

const app = Fastify({
  logger: {
    level: config.isProduction ? 'info' : 'debug',
    transport: config.isProduction ? undefined : { target: 'pino-pretty', options: { colorize: true } },
  },
  trustProxy: true,
});

async function start(): Promise<void> {
  // --- Plugins ---
  await app.register(fastifyCors, {
    origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
    credentials: true,
  });

  await app.register(fastifyCompress);

  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1', '::1'],
    keyGenerator: (request) => {
      return (request.headers['x-api-key'] as string) || request.ip;
    },
  });

  // --- Database ---
  initDb();

  // --- API Routes ---
  registerRoutes(app);

  // --- Static UI ---
  if (existsSync(config.uiDistPath)) {
    await app.register(fastifyStatic, {
      root: config.uiDistPath,
      prefix: '/',
      wildcard: false,
    });

    // SPA fallback — serve index.html for non-API routes
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        reply.code(404).send({ error: 'Not found' });
      } else {
        reply.sendFile('index.html');
      }
    });
  }

  // --- File Watcher ---
  if (config.logFilePath) {
    startFileWatcher();
  }

  // --- Retention Service ---
  startRetentionService();

  // --- Start Server ---
  await app.listen({ port: config.port, host: config.host });
  console.log(`[aist-log] Server running on http://${config.host}:${config.port}`);
}

// --- Graceful Shutdown ---
async function shutdown(signal: string): Promise<void> {
  console.log(`[aist-log] ${signal} received, shutting down...`);
  stopFileWatcher();
  stopRetentionService();
  await app.close();
  closeDb();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch(err => {
  console.error('[aist-log] Failed to start:', err);
  process.exit(1);
});
