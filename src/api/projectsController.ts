import type { FastifyInstance } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { getDb } from '../storage/sqlite.js';
import { getAuthContext } from './auth.js';

function generateApiKey(): string {
  return `aist_${randomBytes(32).toString('hex')}`;
}

function requireAdmin(request: any, reply: any): boolean {
  const ctx = getAuthContext(request);
  if (ctx.role !== 'admin') {
    reply.code(403).send({ error: 'Forbidden — admin access required' });
    return false;
  }
  return true;
}

export function registerProjectsRoutes(app: FastifyInstance): void {
  // List all projects (admin only)
  app.get('/api/projects', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const db = getDb();

    const projects = db.prepare(`
      SELECT p.id, p.name, p.slug, p.api_key, p.created_at, p.settings,
        (SELECT COUNT(*) FROM audit_logs WHERE project_id = p.id) as audit_count,
        (SELECT COUNT(*) FROM request_logs WHERE project_id = p.id) as request_count,
        (SELECT MAX(timestamp) FROM audit_logs WHERE project_id = p.id) as last_audit,
        (SELECT MAX(timestamp) FROM request_logs WHERE project_id = p.id) as last_request
      FROM projects p
      ORDER BY p.created_at DESC
    `).all() as any[];

    return {
      projects: projects.map(p => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        apiKey: p.api_key,
        createdAt: p.created_at,
        settings: p.settings ? JSON.parse(p.settings) : {},
        auditCount: p.audit_count,
        requestCount: p.request_count,
        lastActivity: p.last_audit > p.last_request ? p.last_audit : p.last_request,
      })),
    };
  });

  // Create a project (admin only)
  app.post('/api/projects', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const body = request.body as { name: string; slug?: string };

    if (!body?.name) {
      return reply.code(400).send({ error: 'name is required' });
    }

    const slug = (body.slug || body.name)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    const db = getDb();

    // Check slug uniqueness
    const existing = db.prepare('SELECT id FROM projects WHERE slug = ?').get(slug);
    if (existing) {
      return reply.code(409).send({ error: `Project with slug "${slug}" already exists` });
    }

    const id = randomUUID();
    const apiKey = generateApiKey();

    db.prepare(`
      INSERT INTO projects (id, name, slug, api_key) VALUES (?, ?, ?, ?)
    `).run(id, body.name, slug, apiKey);

    return reply.code(201).send({
      id, name: body.name, slug, apiKey, createdAt: new Date().toISOString(),
    });
  });

  // Get single project (admin only)
  app.get('/api/projects/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const db = getDb();

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const auditCount = (db.prepare('SELECT COUNT(*) as cnt FROM audit_logs WHERE project_id = ?').get(id) as any).cnt;
    const requestCount = (db.prepare('SELECT COUNT(*) as cnt FROM request_logs WHERE project_id = ?').get(id) as any).cnt;

    // Get tag keys
    const rows = db.prepare(`
      SELECT DISTINCT tags FROM audit_logs
      WHERE project_id = ? AND tags IS NOT NULL AND tags != '{}'
      ORDER BY timestamp DESC LIMIT 1000
    `).all(id) as { tags: string }[];
    const tagKeys = new Set<string>();
    for (const row of rows) {
      try { for (const k of Object.keys(JSON.parse(row.tags))) tagKeys.add(k); } catch {}
    }

    return {
      id: project.id, name: project.name, slug: project.slug,
      apiKey: project.api_key, createdAt: project.created_at,
      settings: project.settings ? JSON.parse(project.settings) : {},
      auditCount, requestCount, tagKeys: Array.from(tagKeys).sort(),
    };
  });

  // Regenerate API key (admin only)
  app.post('/api/projects/:id/regenerate-key', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const db = getDb();

    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const newKey = generateApiKey();
    db.prepare('UPDATE projects SET api_key = ? WHERE id = ?').run(newKey, id);

    return { id, apiKey: newKey };
  });

  // Delete a project (admin only)
  app.delete('/api/projects/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const db = getDb();

    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    db.transaction(() => {
      db.prepare('DELETE FROM audit_logs WHERE project_id = ?').run(id);
      db.prepare('DELETE FROM request_logs WHERE project_id = ?').run(id);
      db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    })();

    return { deleted: true };
  });

  // Get current project info (for project-scoped keys)
  app.get('/api/project/me', async (request) => {
    const ctx = getAuthContext(request);
    if (ctx.role === 'admin') {
      return { role: 'admin', projectId: null };
    }
    const db = getDb();
    const project = db.prepare('SELECT id, name, slug, created_at FROM projects WHERE id = ?').get(ctx.projectId!) as any;
    return { role: 'project', ...project };
  });
}
