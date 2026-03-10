# aist-log

**Standalone log server for AISmartTalk and other projects.**

A unified log management platform with request tracing, audit logging, AI-powered reports, multi-tenant project isolation, and a real-time dashboard.

*[Version française ci-dessous](#-version-française)*

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Authentication](#authentication)
- [API Reference](#api-reference)
- [SDK Usage](#sdk-usage)
- [File Ingestion](#file-ingestion)
- [UI Dashboard](#ui-dashboard)
- [Deployment](#deployment)
- [Makefile Commands](#makefile-commands)
- [Database](#database)

---

## Features

- **Request Logs** — Ingest Pino NDJSON structured logs from file with automatic rotation detection
- **Audit Logs** — Ingest custom events via HTTP API with tags, types, and statuses
- **Multi-tenant** — Isolate data per project with scoped API keys
- **AI Reports** — GPT-powered analysis of the last 24h (streamed via SSE)
- **Dashboard** — React + Chakra UI with dark mode, filters, search, export
- **Uptime Kuma** — Optional integration for infrastructure status in reports
- **Retention** — Automatic cleanup of old logs (configurable)
- **CSV Export** — Export request or audit logs to CSV (up to 50k rows)
- **SDK** — TypeScript client with batching, auto-flush, and retry

---

## Architecture

```
┌──────────────┐   file watch    ┌──────────────────────────────┐
│  Pino logs   │ ──────────────► │                              │
│  (NDJSON)    │                 │         aist-log             │
└──────────────┘                 │                              │
                                 │  Fastify + SQLite (WAL)      │
┌──────────────┐   POST /ingest  │                              │  ┌──────────┐
│  Your app    │ ──────────────► │  ┌────────┐  ┌───────────┐  │  │  OpenAI  │
│  (SDK)       │                 │  │ request │  │  audit    │  ├─►│  GPT     │
└──────────────┘                 │  │ _logs   │  │  _logs    │  │  └──────────┘
                                 │  └────────┘  └───────────┘  │
┌──────────────┐   GET /api/*    │                              │  ┌──────────┐
│  Dashboard   │ ◄─────────────► │  ┌────────┐  ┌───────────┐  │  │  Uptime  │
│  (React)     │                 │  │projects │  │ retention │  ├─►│  Kuma    │
└──────────────┘                 │  └────────┘  └───────────┘  │  └──────────┘
                                 └──────────────────────────────┘
```

---

## Quick Start

### Local development

```bash
# 1. Clone and install
make install

# 2. Configure
cp .env.example .env
# Edit .env with your API keys

# 3. Run in dev mode (server + UI with hot-reload)
make dev
```

Server: `http://localhost:3100` — UI dev server: `http://localhost:3101`

### Docker

```bash
make docker-up
# or
docker compose up -d
```

Server + UI: `http://localhost:3100`

---

## Configuration

All settings are in `.env` (see `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3100` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `production` | `development` or `production` |
| `API_KEYS` | `change-me` | Comma-separated admin API keys |
| `SQLITE_PATH` | `./data/logserver.db` | SQLite database path |
| `RETENTION_DAYS` | `30` | Auto-delete logs older than N days |
| `LOG_FILE_PATH` | `./logs/structured.log` | Pino NDJSON file to watch |
| `FILE_POLL_INTERVAL_MS` | `1000` | File watcher poll interval |
| `OPENAI_API_KEY` | *(empty)* | OpenAI key for AI reports |
| `AI_MODEL` | `gpt-4o-mini` | OpenAI model for reports |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins |
| `KUMA_API_URL` | *(empty)* | Uptime Kuma API URL (optional) |
| `KUMA_API_KEY` | *(empty)* | Uptime Kuma API key (optional) |

---

## Authentication

Every `/api/*` endpoint (except `/api/health`) requires an API key.

### Providing the key

Three methods (in priority order):

```bash
# Header
curl -H "X-API-Key: your-key" http://localhost:3100/api/logs

# Bearer token
curl -H "Authorization: Bearer your-key" http://localhost:3100/api/logs

# Query parameter
curl "http://localhost:3100/api/logs?apiKey=your-key"
```

### Key types

| Type | Source | Scope |
|---|---|---|
| **Admin** | `API_KEYS` env var | Full access to all projects and data |
| **Project** | Auto-generated per project | Read/write scoped to one project only |

### Validate a key

```bash
curl -H "X-API-Key: your-key" http://localhost:3100/api/auth/validate
# → { "valid": true, "role": "admin", "projectId": null }
```

---

## API Reference

### Health

#### `GET /api/health`

No auth required.

```json
{
  "status": "ok",
  "uptime": 3600,
  "dbSizeBytes": 524288,
  "requestLogsCount": 1500,
  "auditLogsCount": 300,
  "lastIngestion": "2025-03-10T12:00:00.000Z",
  "fileWatcher": { "active": true, "filePath": "./logs/structured.log", "byteOffset": 48230 },
  "retentionDays": 30
}
```

---

### Projects

#### `GET /api/projects` *(admin only)*

List all projects with stats.

```json
{
  "projects": [
    {
      "id": "uuid",
      "name": "My App",
      "slug": "my-app",
      "apiKey": "aist_abc123...",
      "createdAt": "2025-01-01T00:00:00.000Z",
      "auditCount": 1200,
      "requestCount": 5000,
      "lastActivity": "2025-03-10T12:00:00.000Z"
    }
  ]
}
```

#### `POST /api/projects` *(admin only)*

Create a project. The API key is auto-generated.

```bash
curl -X POST -H "X-API-Key: admin-key" \
  -H "Content-Type: application/json" \
  -d '{"name": "My App", "slug": "my-app"}' \
  http://localhost:3100/api/projects
```

```json
{ "id": "uuid", "name": "My App", "slug": "my-app", "apiKey": "aist_abc123...", "createdAt": "..." }
```

#### `GET /api/projects/:id` *(admin only)*

Get project details including tag keys used in audit logs.

#### `POST /api/projects/:id/regenerate-key` *(admin only)*

Rotate the project API key.

#### `DELETE /api/projects/:id` *(admin only)*

Delete a project and all its logs (cascade).

#### `GET /api/project/me` *(project key only)*

Get current project info when using a project-scoped key.

---

### Request Logs

#### `GET /api/logs`

Query request logs (from file ingestion).

**Query parameters:**

| Param | Type | Description |
|---|---|---|
| `requestId` | string | Trace mode: get all entries for one request |
| `level` | string | Filter by level (`info`, `error`, `warn`...) |
| `method` | string | HTTP method (`GET`, `POST`...) |
| `path` | string | URL path substring |
| `statusCode` | string | Status code or range (`500`, `4xx`, `5xx`) |
| `search` | string | Full-text search |
| `userId` | string | Filter by user ID |
| `chatModelId` | string | Filter by chat model |
| `organizationId` | string | Filter by organization |
| `ip` | string | Filter by IP address |
| `source` | string | Filter by source |
| `from` / `to` | ISO 8601 | Date range |
| `onlyErrors` | boolean | Only show error entries |
| `minDuration` | number | Minimum response time (ms) |
| `page` / `limit` | number | Pagination (default: 1 / 50) |
| `projectId` | string | Admin only: filter by project |

**Grouped response** (default):

```json
{
  "mode": "grouped",
  "groups": [
    {
      "requestId": "req-123",
      "method": "POST",
      "path": "/api/chat",
      "statusCode": 200,
      "duration": 1230,
      "userId": "user-42",
      "startTime": "...",
      "endTime": "...",
      "logCount": 3,
      "hasError": false,
      "entries": [...]
    }
  ],
  "total": 150,
  "page": 1,
  "pages": 3
}
```

**Trace response** (when `requestId` is set):

```json
{
  "mode": "trace",
  "requestId": "req-123",
  "entries": [...],
  "total": 5
}
```

#### `GET /api/logs/stats`

Request log statistics.

| Param | Default | Description |
|---|---|---|
| `timeRange` | `24h` | `24h`, `7d`, or `30d` |
| `projectId` | — | Filter by project (admin) |
| `source` | — | Filter by source |

```json
{
  "totalRequests": 5000,
  "totalErrors": 45,
  "errorRate": 0.9,
  "avgResponseTime": 230,
  "statusDistribution": { "200": 4500, "500": 45, "404": 100 },
  "levelDistribution": { "info": 4900, "error": 45, "warn": 55 },
  "topPaths": [
    { "path": "/api/chat", "count": 2000, "avgDuration": 1500 }
  ]
}
```

#### `GET /api/logs/export`

Export request logs as CSV (max 50,000 rows).

| Param | Description |
|---|---|
| `from` / `to` | Date range |
| `source` | Filter by source |
| `level` | Filter by level |

#### `GET /api/logs/report`

AI-powered analysis report streamed via Server-Sent Events.

| Param | Description |
|---|---|
| `source` | Filter by source (optional) |

**SSE events:**

```
data: {"type":"stats","data":{"totalRequests":5000,...}}
data: {"type":"token","content":"## Summary\n"}
data: {"type":"token","content":"The system processed..."}
data: {"type":"done"}
```

---

### Audit Logs

#### `POST /api/ingest`

Ingest audit log entries.

```bash
curl -X POST -H "X-API-Key: aist_project-key" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "my-app",
    "logs": [
      {
        "type": "USER_LOGIN",
        "status": "SUCCESS",
        "userId": "user-42",
        "details": { "method": "oauth", "provider": "google" },
        "tags": { "environment": "production", "region": "eu-west-1" }
      },
      {
        "type": "PAYMENT_PROCESSED",
        "status": "SUCCESS",
        "userId": "user-42",
        "details": { "amount": 49.99, "currency": "EUR" },
        "tags": { "plan": "pro" }
      }
    ]
  }' \
  http://localhost:3100/api/ingest
```

```json
{ "ingested": 2, "source": "my-app", "projectId": "uuid" }
```

**Constraints:**
- Max **1,000 logs** per batch
- `type` and `status` are required per entry
- `timestamp` defaults to `now()` if omitted
- Project keys can only write to their own project

#### `GET /api/audit/logs`

Query audit logs.

| Param | Type | Description |
|---|---|---|
| `projectId` | string | Admin: filter by project |
| `source` | string | Filter by source |
| `logType` | string | Single or comma-separated types |
| `status` | string | Single or comma-separated statuses |
| `userId` | string | Substring match on userId |
| `entityId` | string | Legacy: searches `tags.entityId` |
| `tag.KEY=VALUE` | string | Tag filter (e.g. `tag.environment=production`) |
| `from` / `to` | ISO 8601 | Date range |
| `search` | string | Full-text search in type, error, details, tags |
| `page` / `limit` | number | Pagination (default: 1 / 50) |

```json
{
  "logs": [
    {
      "id": 1,
      "timestamp": "2025-03-10T12:00:00.000Z",
      "log_type": "USER_LOGIN",
      "status": "SUCCESS",
      "details": "{\"method\":\"oauth\"}",
      "error_message": null,
      "user_id": "user-42",
      "tags": "{\"environment\":\"production\"}",
      "source": "my-app",
      "project_id": "uuid"
    }
  ],
  "total": 1,
  "page": 1,
  "pages": 1
}
```

#### `GET /api/audit/stats`

Audit log statistics.

| Param | Type | Description |
|---|---|---|
| `timeRange` | string | `24h`, `7d`, or `30d` |
| `from` / `to` | ISO 8601 | Custom date range |
| `projectId` | string | Filter by project |
| `source` | string | Filter by source |
| `tag.KEY=VALUE` | string | Tag filters |

```json
{
  "totalLogs": 300,
  "byType": { "USER_LOGIN": 150, "PAYMENT_PROCESSED": 150 },
  "byStatus": { "SUCCESS": 280, "FAILURE": 20 },
  "timeDistribution": {
    "labels": ["2025-03-08", "2025-03-09", "2025-03-10"],
    "data": [90, 100, 110]
  }
}
```

#### `GET /api/audit/export`

Export audit logs as CSV (max 50,000 rows).

| Param | Description |
|---|---|
| `from` / `to` | Date range |
| `source` | Filter by source |
| `logType` | Filter by type |

---

### Sources

#### `GET /api/sources`

List all log sources with stats.

```json
{
  "sources": [
    { "source": "my-app", "auditCount": 300, "requestCount": 5000, "lastActivity": "..." }
  ]
}
```

#### `GET /api/sources/:source/tag-keys`

Get available tag keys for a source (useful for dynamic UI filters).

```json
{ "tagKeys": ["environment", "region", "plan"] }
```

---

## SDK Usage

### Installation

The SDK is included in the project at `src/sdk/`. Import it directly or copy it to your project.

```typescript
import { LogServerClient } from './sdk/LogServerClient.js';
// or copy src/sdk/ to your project
```

### Initialize

```typescript
const logger = new LogServerClient({
  url: 'http://localhost:3100',
  apiKey: 'aist_your-project-key',
  source: 'my-app',

  // Optional
  defaultTags: { environment: 'production', version: '2.1.0' },
  batchSize: 50,           // Flush every 50 logs (default)
  flushIntervalMs: 5000,   // Auto-flush every 5s (default)
  onError: (err) => console.error('Log delivery failed:', err),
});
```

### Send logs

```typescript
// Simple event
await logger.log({
  type: 'USER_LOGIN',
  status: 'SUCCESS',
  userId: 'user-42',
});

// With details and tags
await logger.log({
  type: 'PAYMENT_PROCESSED',
  status: 'SUCCESS',
  userId: 'user-42',
  details: { amount: 49.99, currency: 'EUR', gateway: 'stripe' },
  tags: { plan: 'pro', region: 'eu-west-1' },
});

// Error event
await logger.log({
  type: 'EMAIL_SEND',
  status: 'FAILURE',
  errorMessage: 'SMTP connection refused',
  details: { to: 'user@example.com', template: 'welcome' },
  tags: { provider: 'sendgrid' },
});
```

### Shutdown gracefully

```typescript
// Flush remaining logs before exit
await logger.shutdown();
```

### SDK internals

| Feature | Detail |
|---|---|
| **Batching** | Logs are buffered and sent in batches of `batchSize` |
| **Auto-flush** | Timer flushes every `flushIntervalMs` even if batch isn't full |
| **Retry** | On HTTP failure, logs are put back in the buffer |
| **Memory safety** | Buffer is capped at 10,000 entries (oldest trimmed) |
| **Default tags** | Merged into every log entry automatically |
| **Pending count** | `logger.pendingCount` returns buffered log count |

### Express/Fastify middleware example

```typescript
import { LogServerClient } from './sdk/LogServerClient.js';

const auditLogger = new LogServerClient({
  url: process.env.LOG_SERVER_URL!,
  apiKey: process.env.LOG_SERVER_KEY!,
  source: 'my-api',
});

// Express middleware
app.use((req, res, next) => {
  res.on('finish', () => {
    if (req.path.startsWith('/api/admin')) {
      auditLogger.log({
        type: 'ADMIN_ACTION',
        status: res.statusCode < 400 ? 'SUCCESS' : 'FAILURE',
        userId: req.user?.id,
        details: { method: req.method, path: req.path, statusCode: res.statusCode },
        tags: { ip: req.ip },
      });
    }
  });
  next();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await auditLogger.shutdown();
  process.exit(0);
});
```

### Direct HTTP usage (without SDK)

```bash
curl -X POST http://localhost:3100/api/ingest \
  -H "X-API-Key: aist_your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "my-app",
    "logs": [
      {
        "type": "DEPLOY",
        "status": "SUCCESS",
        "details": {"version": "2.1.0", "commit": "abc123"},
        "tags": {"environment": "production"}
      }
    ]
  }'
```

---

## File Ingestion

aist-log watches a Pino NDJSON log file and ingests request logs automatically.

### How it works

1. The file watcher monitors `LOG_FILE_PATH` using polling (chokidar)
2. On startup and each change, it reads from the last saved byte offset
3. Each JSON line is parsed and inserted into `request_logs`
4. The offset and inode are saved in `file_offsets` for crash recovery
5. File rotation is detected (inode change or file shrink) and offset resets to 0

### Expected log format

Each line must be a valid JSON object with Pino fields:

```json
{"level":30,"time":"2025-03-10T12:00:00.000Z","msg":"request completed","requestId":"req-123","method":"POST","path":"/api/chat","statusCode":200,"duration":1230,"userId":"user-42","chatModelId":"gpt-4","organizationId":"org-1","ip":"1.2.3.4"}
```

**Supported fields:**

| Field | Type | Description |
|---|---|---|
| `time` | string | ISO timestamp |
| `level` | number/string | Pino log level |
| `msg` | string | Log message |
| `requestId` | string | Request correlation ID |
| `method` | string | HTTP method |
| `path` | string | URL path |
| `statusCode` | number | HTTP status code |
| `duration` | number | Response time in ms |
| `userId` | string | User identifier |
| `chatModelId` | string | AI model used |
| `organizationId` | string | Organization identifier |
| `ip` | string | Client IP |
| `err` | object | `{ message, stack }` for errors |

### Pino setup example

```typescript
import pino from 'pino';

const logger = pino({
  transport: {
    targets: [
      { target: 'pino-pretty', level: 'info' },           // Console
      { target: 'pino/file', options: { destination: './logs/structured.log' }, level: 'info' }  // File for aist-log
    ]
  }
});
```

---

## UI Dashboard

The dashboard is served at the root URL (`/`) in production mode.

### Access

1. Open `http://localhost:3100` (production) or `http://localhost:3101` (dev)
2. Enter your API key (admin or project)
3. If admin: select a project or view all

### Features

- **Request Logs tab** — Grouped by request ID, expandable entries, color-coded status/duration/level
- **Audit Logs tab** — Filterable by type, status, tags, full-text search
- **AI Report tab** — Streaming GPT analysis of the last 24h with metrics cards and Kuma status
- **Filters** — Search, level, method, status code, date range, duration, tags, error-only toggle
- **Export** — Download CSV from any view
- **Dark mode** — Toggle in header
- **Project management** — Create/delete projects, regenerate API keys (admin only)

---

## Deployment

### Docker (recommended)

```bash
# Production with Docker Compose
make docker-up

# Rebuild after code changes
make docker-rebuild

# View logs
make docker-logs

# Stop
make docker-down
```

The `docker-compose.yml` mounts:
- `../aismarttalk/logs:/app/logs:ro` — Shared Pino log file (read-only)
- `logserver-data:/data` — Persistent SQLite volume

### Standalone Node.js

```bash
make build
NODE_ENV=production node dist/index.js
```

### Behind a reverse proxy (nginx)

```nginx
server {
    listen 443 ssl;
    server_name logs.example.com;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # SSE support for AI reports
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

### Environment checklist

- [ ] Set strong `API_KEYS` (comma-separated for multiple admins)
- [ ] Set `SQLITE_PATH` to a persistent volume
- [ ] Set `CORS_ORIGINS` to your domain(s)
- [ ] Set `OPENAI_API_KEY` if you want AI reports
- [ ] Set `RETENTION_DAYS` for your compliance needs
- [ ] Create projects and use project API keys for each app

---

## Makefile Commands

```
make help              Show all commands
make install           Install dependencies (server + UI)
make dev               Dev mode with hot-reload (server + UI)
make dev-server        Server only (tsx watch)
make dev-ui            UI only (vite)
make build             Build for production
make start             Build + start server
make docker-up         Start with Docker Compose
make docker-down       Stop containers
make docker-rebuild    Rebuild + restart
make docker-logs       Tail Docker logs
make docker-restart    Restart containers
make docker-status     Show container status
make lint              Run ESLint
make check             Type-check without emitting
make clean             Remove dist/
make clean-deps        Remove node_modules/
make reset-db          Delete local SQLite database
make reset             Full reset (artifacts + deps + DB)
make nuke              Full reset + Docker volumes
```

---

## Database

SQLite with WAL mode. Schema managed via automatic migrations on startup.

### Tables

| Table | Purpose |
|---|---|
| `request_logs` | Pino structured log entries (from file watcher) |
| `audit_logs` | Custom audit events (from SDK / HTTP API) |
| `projects` | Multi-tenant project registry |
| `file_offsets` | File watcher offset tracking |

### Performance

- WAL mode for concurrent reads during writes
- 64 MB cache, in-memory temp storage
- Indexes on: timestamp, request_id, path, status_code, level, user_id, source, project_id
- Automatic retention cleanup every 6 hours
- Incremental vacuum after cleanup

---

---

# Version Française

# aist-log

**Serveur de logs autonome pour AISmartTalk et autres projets.**

Plateforme unifiée de gestion de logs avec traçage de requêtes, journalisation d'audit, rapports IA, isolation multi-tenant, et tableau de bord temps réel.

---

## Table des matières

- [Fonctionnalités](#fonctionnalités)
- [Architecture](#architecture-1)
- [Démarrage rapide](#démarrage-rapide)
- [Configuration](#configuration-1)
- [Authentification](#authentification)
- [Référence API](#référence-api)
- [Utilisation du SDK](#utilisation-du-sdk)
- [Ingestion de fichiers](#ingestion-de-fichiers)
- [Tableau de bord](#tableau-de-bord)
- [Déploiement](#déploiement)
- [Commandes Makefile](#commandes-makefile)
- [Base de données](#base-de-données)

---

## Fonctionnalités

- **Logs de requêtes** — Ingestion de logs Pino NDJSON depuis un fichier avec détection automatique de rotation
- **Logs d'audit** — Ingestion d'événements personnalisés via API HTTP avec tags, types et statuts
- **Multi-tenant** — Isolation des données par projet avec clés API dédiées
- **Rapports IA** — Analyse GPT des dernières 24h (streaming SSE)
- **Tableau de bord** — React + Chakra UI avec mode sombre, filtres, recherche, export
- **Uptime Kuma** — Intégration optionnelle du statut d'infrastructure dans les rapports
- **Rétention** — Nettoyage automatique des anciens logs (configurable)
- **Export CSV** — Export des logs requêtes ou audit en CSV (max 50k lignes)
- **SDK** — Client TypeScript avec batching, auto-flush et retry

---

## Architecture

```
┌──────────────┐   surveillance   ┌──────────────────────────────┐
│  Logs Pino   │ ──────────────►  │                              │
│  (NDJSON)    │                  │         aist-log             │
└──────────────┘                  │                              │
                                  │  Fastify + SQLite (WAL)      │
┌──────────────┐   POST /ingest   │                              │  ┌──────────┐
│  Votre app   │ ──────────────►  │  ┌────────┐  ┌───────────┐  │  │  OpenAI  │
│  (SDK)       │                  │  │ request │  │  audit    │  ├─►│  GPT     │
└──────────────┘                  │  │ _logs   │  │  _logs    │  │  └──────────┘
                                  │  └────────┘  └───────────┘  │
┌──────────────┐   GET /api/*     │                              │  ┌──────────┐
│  Dashboard   │ ◄──────────────► │  ┌────────┐  ┌───────────┐  │  │  Uptime  │
│  (React)     │                  │  │projects │  │ rétention │  ├─►│  Kuma    │
└──────────────┘                  │  └────────┘  └───────────┘  │  └──────────┘
                                  └──────────────────────────────┘
```

---

## Démarrage rapide

### Développement local

```bash
# 1. Cloner et installer
make install

# 2. Configurer
cp .env.example .env
# Éditer .env avec vos clés

# 3. Lancer en mode dev (serveur + UI avec hot-reload)
make dev
```

Serveur : `http://localhost:3100` — UI dev : `http://localhost:3101`

### Docker

```bash
make docker-up
# ou
docker compose up -d
```

Serveur + UI : `http://localhost:3100`

---

## Configuration

Tous les paramètres sont dans `.env` (voir `.env.example`) :

| Variable | Défaut | Description |
|---|---|---|
| `PORT` | `3100` | Port du serveur |
| `HOST` | `0.0.0.0` | Adresse d'écoute |
| `NODE_ENV` | `production` | `development` ou `production` |
| `API_KEYS` | `change-me` | Clés API admin séparées par des virgules |
| `SQLITE_PATH` | `./data/logserver.db` | Chemin de la base SQLite |
| `RETENTION_DAYS` | `30` | Suppression auto des logs après N jours |
| `LOG_FILE_PATH` | `./logs/structured.log` | Fichier Pino NDJSON à surveiller |
| `FILE_POLL_INTERVAL_MS` | `1000` | Intervalle de polling du watcher |
| `OPENAI_API_KEY` | *(vide)* | Clé OpenAI pour les rapports IA |
| `AI_MODEL` | `gpt-4o-mini` | Modèle OpenAI pour les rapports |
| `CORS_ORIGINS` | `*` | Origines CORS autorisées (virgules) |
| `KUMA_API_URL` | *(vide)* | URL API Uptime Kuma (optionnel) |
| `KUMA_API_KEY` | *(vide)* | Clé API Uptime Kuma (optionnel) |

---

## Authentification

Chaque endpoint `/api/*` (sauf `/api/health`) requiert une clé API.

### Fournir la clé

Trois méthodes (par ordre de priorité) :

```bash
# Header
curl -H "X-API-Key: votre-clé" http://localhost:3100/api/logs

# Bearer token
curl -H "Authorization: Bearer votre-clé" http://localhost:3100/api/logs

# Paramètre de requête
curl "http://localhost:3100/api/logs?apiKey=votre-clé"
```

### Types de clés

| Type | Source | Portée |
|---|---|---|
| **Admin** | Variable `API_KEYS` | Accès complet à tous les projets |
| **Projet** | Générée automatiquement | Lecture/écriture limitée à un projet |

### Valider une clé

```bash
curl -H "X-API-Key: votre-clé" http://localhost:3100/api/auth/validate
# → { "valid": true, "role": "admin", "projectId": null }
```

---

## Référence API

### Santé

#### `GET /api/health`

Sans authentification.

```json
{
  "status": "ok",
  "uptime": 3600,
  "dbSizeBytes": 524288,
  "requestLogsCount": 1500,
  "auditLogsCount": 300,
  "lastIngestion": "2025-03-10T12:00:00.000Z",
  "fileWatcher": { "active": true, "filePath": "./logs/structured.log", "byteOffset": 48230 },
  "retentionDays": 30
}
```

---

### Projets

#### `GET /api/projects` *(admin uniquement)*

Liste tous les projets avec statistiques.

#### `POST /api/projects` *(admin uniquement)*

Créer un projet. La clé API est générée automatiquement.

```bash
curl -X POST -H "X-API-Key: clé-admin" \
  -H "Content-Type: application/json" \
  -d '{"name": "Mon App", "slug": "mon-app"}' \
  http://localhost:3100/api/projects
```

#### `GET /api/projects/:id` *(admin uniquement)*

Détails du projet avec les clés de tags utilisées.

#### `POST /api/projects/:id/regenerate-key` *(admin uniquement)*

Régénérer la clé API du projet.

#### `DELETE /api/projects/:id` *(admin uniquement)*

Supprimer un projet et tous ses logs (cascade).

#### `GET /api/project/me` *(clé projet uniquement)*

Infos du projet courant avec une clé projet.

---

### Logs de requêtes

#### `GET /api/logs`

Interroger les logs de requêtes (issus de l'ingestion fichier).

**Paramètres de requête :**

| Param | Type | Description |
|---|---|---|
| `requestId` | string | Mode trace : toutes les entrées d'une requête |
| `level` | string | Filtrer par niveau (`info`, `error`, `warn`...) |
| `method` | string | Méthode HTTP (`GET`, `POST`...) |
| `path` | string | Sous-chaîne du chemin URL |
| `statusCode` | string | Code statut ou plage (`500`, `4xx`, `5xx`) |
| `search` | string | Recherche plein texte |
| `userId` | string | Filtrer par utilisateur |
| `chatModelId` | string | Filtrer par modèle IA |
| `organizationId` | string | Filtrer par organisation |
| `ip` | string | Filtrer par adresse IP |
| `source` | string | Filtrer par source |
| `from` / `to` | ISO 8601 | Plage de dates |
| `onlyErrors` | boolean | Erreurs uniquement |
| `minDuration` | number | Temps de réponse minimum (ms) |
| `page` / `limit` | number | Pagination (défaut : 1 / 50) |
| `projectId` | string | Admin : filtrer par projet |

**Réponse groupée** (par défaut) :

```json
{
  "mode": "grouped",
  "groups": [
    {
      "requestId": "req-123",
      "method": "POST",
      "path": "/api/chat",
      "statusCode": 200,
      "duration": 1230,
      "userId": "user-42",
      "startTime": "...",
      "endTime": "...",
      "logCount": 3,
      "hasError": false,
      "entries": [...]
    }
  ],
  "total": 150,
  "page": 1,
  "pages": 3
}
```

**Réponse trace** (quand `requestId` est défini) :

```json
{
  "mode": "trace",
  "requestId": "req-123",
  "entries": [...],
  "total": 5
}
```

#### `GET /api/logs/stats`

Statistiques des logs de requêtes.

| Param | Défaut | Description |
|---|---|---|
| `timeRange` | `24h` | `24h`, `7d`, ou `30d` |
| `projectId` | — | Filtrer par projet (admin) |
| `source` | — | Filtrer par source |

```json
{
  "totalRequests": 5000,
  "totalErrors": 45,
  "errorRate": 0.9,
  "avgResponseTime": 230,
  "statusDistribution": { "200": 4500, "500": 45, "404": 100 },
  "levelDistribution": { "info": 4900, "error": 45, "warn": 55 },
  "topPaths": [
    { "path": "/api/chat", "count": 2000, "avgDuration": 1500 }
  ]
}
```

#### `GET /api/logs/export`

Exporter les logs de requêtes en CSV (max 50 000 lignes).

| Param | Description |
|---|---|
| `from` / `to` | Plage de dates |
| `source` | Filtrer par source |
| `level` | Filtrer par niveau |

#### `GET /api/logs/report`

Rapport d'analyse IA en streaming (Server-Sent Events).

| Param | Description |
|---|---|
| `source` | Filtrer par source (optionnel) |

**Événements SSE :**

```
data: {"type":"stats","data":{"totalRequests":5000,...}}
data: {"type":"token","content":"## Résumé\n"}
data: {"type":"token","content":"Le système a traité..."}
data: {"type":"done"}
```

---

### Logs d'audit

#### `POST /api/ingest`

Ingérer des entrées de logs d'audit.

```bash
curl -X POST -H "X-API-Key: aist_clé-projet" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "mon-app",
    "logs": [
      {
        "type": "CONNEXION_UTILISATEUR",
        "status": "SUCCESS",
        "userId": "user-42",
        "details": { "methode": "oauth", "fournisseur": "google" },
        "tags": { "environnement": "production", "region": "eu-west-1" }
      }
    ]
  }' \
  http://localhost:3100/api/ingest
```

```json
{ "ingested": 1, "source": "mon-app", "projectId": "uuid" }
```

**Contraintes :**
- Maximum **1 000 logs** par batch
- `type` et `status` requis par entrée
- `timestamp` par défaut à `now()` si omis
- Les clés projet ne peuvent écrire que dans leur projet

#### `GET /api/audit/logs`

Interroger les logs d'audit.

| Param | Type | Description |
|---|---|---|
| `projectId` | string | Admin : filtrer par projet |
| `source` | string | Filtrer par source |
| `logType` | string | Un ou plusieurs types (virgules) |
| `status` | string | Un ou plusieurs statuts (virgules) |
| `userId` | string | Recherche par sous-chaîne |
| `entityId` | string | Legacy : cherche dans `tags.entityId` |
| `tag.CLÉ=VALEUR` | string | Filtre par tag (ex: `tag.environment=production`) |
| `from` / `to` | ISO 8601 | Plage de dates |
| `search` | string | Recherche plein texte |
| `page` / `limit` | number | Pagination (défaut : 1 / 50) |

#### `GET /api/audit/stats`

Statistiques des logs d'audit.

| Param | Type | Description |
|---|---|---|
| `timeRange` | string | `24h`, `7d`, ou `30d` |
| `from` / `to` | ISO 8601 | Plage personnalisée |
| `projectId` | string | Filtrer par projet |
| `source` | string | Filtrer par source |
| `tag.CLÉ=VALEUR` | string | Filtres par tag |

```json
{
  "totalLogs": 300,
  "byType": { "CONNEXION_UTILISATEUR": 150, "PAIEMENT": 150 },
  "byStatus": { "SUCCESS": 280, "FAILURE": 20 },
  "timeDistribution": {
    "labels": ["2025-03-08", "2025-03-09", "2025-03-10"],
    "data": [90, 100, 110]
  }
}
```

#### `GET /api/audit/export`

Exporter les logs d'audit en CSV (max 50 000 lignes).

---

### Sources

#### `GET /api/sources`

Liste toutes les sources de logs avec statistiques.

#### `GET /api/sources/:source/tag-keys`

Clés de tags disponibles pour une source (utile pour les filtres dynamiques).

```json
{ "tagKeys": ["environment", "region", "plan"] }
```

---

## Utilisation du SDK

### Initialisation

```typescript
import { LogServerClient } from './sdk/LogServerClient.js';

const logger = new LogServerClient({
  url: 'http://localhost:3100',
  apiKey: 'aist_votre-clé-projet',
  source: 'mon-app',

  // Optionnel
  defaultTags: { environnement: 'production', version: '2.1.0' },
  batchSize: 50,           // Flush tous les 50 logs (défaut)
  flushIntervalMs: 5000,   // Auto-flush toutes les 5s (défaut)
  onError: (err) => console.error('Envoi échoué:', err),
});
```

### Envoyer des logs

```typescript
// Événement simple
await logger.log({
  type: 'CONNEXION_UTILISATEUR',
  status: 'SUCCESS',
  userId: 'user-42',
});

// Avec détails et tags
await logger.log({
  type: 'PAIEMENT_TRAITÉ',
  status: 'SUCCESS',
  userId: 'user-42',
  details: { montant: 49.99, devise: 'EUR', passerelle: 'stripe' },
  tags: { plan: 'pro', region: 'eu-west-1' },
});

// Événement d'erreur
await logger.log({
  type: 'ENVOI_EMAIL',
  status: 'FAILURE',
  errorMessage: 'Connexion SMTP refusée',
  details: { destinataire: 'user@example.com', template: 'bienvenue' },
  tags: { fournisseur: 'sendgrid' },
});
```

### Arrêt propre

```typescript
// Envoyer les logs restants avant de quitter
await logger.shutdown();
```

### Fonctionnement interne du SDK

| Fonctionnalité | Détail |
|---|---|
| **Batching** | Les logs sont mis en tampon et envoyés par lots de `batchSize` |
| **Auto-flush** | Un timer envoie toutes les `flushIntervalMs` même si le lot n'est pas plein |
| **Retry** | En cas d'échec HTTP, les logs sont remis dans le tampon |
| **Sécurité mémoire** | Le tampon est plafonné à 10 000 entrées (les plus anciennes supprimées) |
| **Tags par défaut** | Fusionnés automatiquement dans chaque log |
| **Compteur** | `logger.pendingCount` retourne le nombre de logs en tampon |

### Exemple middleware Express/Fastify

```typescript
import { LogServerClient } from './sdk/LogServerClient.js';

const auditLogger = new LogServerClient({
  url: process.env.LOG_SERVER_URL!,
  apiKey: process.env.LOG_SERVER_KEY!,
  source: 'mon-api',
});

// Middleware Express
app.use((req, res, next) => {
  res.on('finish', () => {
    if (req.path.startsWith('/api/admin')) {
      auditLogger.log({
        type: 'ACTION_ADMIN',
        status: res.statusCode < 400 ? 'SUCCESS' : 'FAILURE',
        userId: req.user?.id,
        details: { method: req.method, path: req.path, statusCode: res.statusCode },
        tags: { ip: req.ip },
      });
    }
  });
  next();
});

// Arrêt propre
process.on('SIGTERM', async () => {
  await auditLogger.shutdown();
  process.exit(0);
});
```

### Utilisation HTTP directe (sans SDK)

```bash
curl -X POST http://localhost:3100/api/ingest \
  -H "X-API-Key: aist_votre-clé" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "mon-app",
    "logs": [
      {
        "type": "DEPLOIEMENT",
        "status": "SUCCESS",
        "details": {"version": "2.1.0", "commit": "abc123"},
        "tags": {"environnement": "production"}
      }
    ]
  }'
```

---

## Ingestion de fichiers

aist-log surveille un fichier de logs Pino NDJSON et ingère les logs de requêtes automatiquement.

### Fonctionnement

1. Le watcher surveille `LOG_FILE_PATH` par polling (chokidar)
2. Au démarrage et à chaque modification, il lit depuis le dernier offset sauvegardé
3. Chaque ligne JSON est parsée et insérée dans `request_logs`
4. L'offset et l'inode sont sauvegardés dans `file_offsets` pour la reprise après crash
5. La rotation de fichier est détectée (changement d'inode ou réduction de taille) et l'offset repart à 0

### Format de log attendu

Chaque ligne doit être un objet JSON valide avec les champs Pino :

```json
{"level":30,"time":"2025-03-10T12:00:00.000Z","msg":"request completed","requestId":"req-123","method":"POST","path":"/api/chat","statusCode":200,"duration":1230,"userId":"user-42"}
```

**Champs supportés :**

| Champ | Type | Description |
|---|---|---|
| `time` | string | Horodatage ISO |
| `level` | number/string | Niveau de log Pino |
| `msg` | string | Message du log |
| `requestId` | string | ID de corrélation de requête |
| `method` | string | Méthode HTTP |
| `path` | string | Chemin URL |
| `statusCode` | number | Code de statut HTTP |
| `duration` | number | Temps de réponse en ms |
| `userId` | string | Identifiant utilisateur |
| `chatModelId` | string | Modèle IA utilisé |
| `organizationId` | string | Identifiant d'organisation |
| `ip` | string | IP du client |
| `err` | object | `{ message, stack }` pour les erreurs |

### Exemple de configuration Pino

```typescript
import pino from 'pino';

const logger = pino({
  transport: {
    targets: [
      { target: 'pino-pretty', level: 'info' },           // Console
      { target: 'pino/file', options: { destination: './logs/structured.log' }, level: 'info' }  // Fichier pour aist-log
    ]
  }
});
```

---

## Tableau de bord

Le dashboard est servi à la racine (`/`) en mode production.

### Accès

1. Ouvrir `http://localhost:3100` (production) ou `http://localhost:3101` (dev)
2. Entrer votre clé API (admin ou projet)
3. Si admin : sélectionner un projet ou voir tout

### Fonctionnalités

- **Onglet Logs de requêtes** — Groupés par request ID, entrées dépliables, couleurs par statut/durée/niveau
- **Onglet Logs d'audit** — Filtrable par type, statut, tags, recherche plein texte
- **Onglet Rapport IA** — Analyse GPT en streaming des dernières 24h avec cartes métriques et statut Kuma
- **Filtres** — Recherche, niveau, méthode, code statut, plage de dates, durée, tags, toggle erreurs
- **Export** — Télécharger en CSV depuis n'importe quelle vue
- **Mode sombre** — Toggle dans le header
- **Gestion de projets** — Créer/supprimer projets, régénérer clés API (admin uniquement)

---

## Déploiement

### Docker (recommandé)

```bash
# Production avec Docker Compose
make docker-up

# Rebuild après modifications
make docker-rebuild

# Voir les logs
make docker-logs

# Arrêter
make docker-down
```

Le `docker-compose.yml` monte :
- `../aismarttalk/logs:/app/logs:ro` — Fichier de logs Pino partagé (lecture seule)
- `logserver-data:/data` — Volume persistant SQLite

### Node.js standalone

```bash
make build
NODE_ENV=production node dist/index.js
```

### Derrière un reverse proxy (nginx)

```nginx
server {
    listen 443 ssl;
    server_name logs.example.com;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # Support SSE pour les rapports IA
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

### Checklist environnement

- [ ] Définir des `API_KEYS` robustes (virgules pour plusieurs admins)
- [ ] Définir `SQLITE_PATH` vers un volume persistant
- [ ] Définir `CORS_ORIGINS` avec vos domaines
- [ ] Définir `OPENAI_API_KEY` si vous voulez les rapports IA
- [ ] Définir `RETENTION_DAYS` selon vos besoins de conformité
- [ ] Créer des projets et utiliser les clés projet pour chaque app

---

## Commandes Makefile

```
make help              Afficher toutes les commandes
make install           Installer les dépendances (serveur + UI)
make dev               Mode dev avec hot-reload (serveur + UI)
make dev-server        Serveur seul (tsx watch)
make dev-ui            UI seule (vite)
make build             Build de production
make start             Build + démarrer le serveur
make docker-up         Démarrer avec Docker Compose
make docker-down       Arrêter les containers
make docker-rebuild    Rebuild + redémarrer
make docker-logs       Suivre les logs Docker
make docker-restart    Redémarrer les containers
make docker-status     Statut des containers
make lint              Lancer ESLint
make check             Vérification de types sans compilation
make clean             Supprimer dist/
make clean-deps        Supprimer node_modules/
make reset-db          Supprimer la base SQLite locale
make reset             Reset complet (artifacts + deps + DB)
make nuke              Reset complet + volumes Docker
```

---

## Base de données

SQLite en mode WAL. Schéma géré par migrations automatiques au démarrage.

### Tables

| Table | Usage |
|---|---|
| `request_logs` | Entrées de logs structurés Pino (depuis le watcher) |
| `audit_logs` | Événements d'audit personnalisés (depuis le SDK / API HTTP) |
| `projects` | Registre de projets multi-tenant |
| `file_offsets` | Suivi de l'offset du watcher |

### Performance

- Mode WAL pour lectures concurrentes pendant les écritures
- Cache de 64 Mo, stockage temporaire en mémoire
- Index sur : timestamp, request_id, path, status_code, level, user_id, source, project_id
- Nettoyage automatique par rétention toutes les 6 heures
- Vacuum incrémental après nettoyage

---

## License

MIT
