import type { FastifyInstance } from 'fastify';
import { authMiddleware, registerAuthRoutes } from './auth.js';
import { registerLogsRoutes } from './logsController.js';
import { registerStatsRoutes } from './statsController.js';
import { registerReportRoutes } from './reportController.js';
import { registerExportRoutes } from './exportController.js';
import { registerIngestRoutes } from './ingestController.js';
import { registerHealthRoutes } from './healthController.js';
import { registerSourcesRoutes } from './sourcesController.js';
import { registerProjectsRoutes } from './projectsController.js';

export function registerRoutes(app: FastifyInstance): void {
  // Auth middleware for all /api/* routes (except health)
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    if (request.url.startsWith('/api/health')) return;
    return authMiddleware(request, reply);
  });

  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerLogsRoutes(app);
  registerStatsRoutes(app);
  registerReportRoutes(app);
  registerExportRoutes(app);
  registerIngestRoutes(app);
  registerSourcesRoutes(app);
  registerProjectsRoutes(app);
}
