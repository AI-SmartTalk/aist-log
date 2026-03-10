import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';
import { getDb } from '../storage/sqlite.js';

export interface AuthContext {
  /** 'admin' for master API keys, 'project' for project-scoped keys */
  role: 'admin' | 'project';
  /** Project ID if authenticated via project key, null for admin */
  projectId: string | null;
  /** Project slug if authenticated via project key */
  projectSlug: string | null;
}

const AUTH_KEY = 'authContext';

/** Retrieve the auth context attached to a request (throws if not authenticated) */
export function getAuthContext(request: FastifyRequest): AuthContext {
  const ctx = (request as any)[AUTH_KEY] as AuthContext | undefined;
  if (!ctx) {
    throw new Error('Auth context missing — request was not authenticated');
  }
  return ctx;
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | void> {
  const apiKey =
    (request.headers['x-api-key'] as string) ||
    extractBearerToken(request.headers.authorization) ||
    (request.query as Record<string, string>)?.apiKey;

  if (!apiKey) {
    return reply.code(401).send({ error: 'Unauthorized — missing API key' });
  }

  // Check admin keys first
  if (config.apiKeys.includes(apiKey)) {
    (request as any)[AUTH_KEY] = { role: 'admin', projectId: null, projectSlug: null } satisfies AuthContext;
    return;
  }

  // Check project keys
  const db = getDb();
  const project = db.prepare('SELECT id, slug FROM projects WHERE api_key = ?').get(apiKey) as
    | { id: string; slug: string }
    | undefined;

  if (project) {
    (request as any)[AUTH_KEY] = { role: 'project', projectId: project.id, projectSlug: project.slug } satisfies AuthContext;
    return;
  }

  return reply.code(401).send({ error: 'Unauthorized — invalid API key' });
}

function extractBearerToken(header?: string): string | undefined {
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice(7);
}

/**
 * Register the /api/auth/validate endpoint.
 * Used by the UI to verify an API key before granting access.
 */
export function registerAuthRoutes(app: import('fastify').FastifyInstance): void {
  app.get('/api/auth/validate', async (request) => {
    const ctx = getAuthContext(request);
    return { valid: true, role: ctx.role, projectId: ctx.projectId };
  });
}
