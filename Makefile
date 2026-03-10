.PHONY: help install dev build start stop restart logs \
       docker-up docker-down docker-rebuild docker-logs \
       clean reset reset-db lint check env

# ─── Config ──────────────────────────────────────────────
COMPOSE  = docker compose
APP_NAME = aist-log

# ─── Help ────────────────────────────────────────────────
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ─── Setup ───────────────────────────────────────────────
env: ## Create .env from .env.example (no overwrite)
	@test -f .env || cp .env.example .env && echo ".env ready"

install: env ## Install all dependencies (server + UI)
	npm install
	cd ui && npm install

# ─── Local dev ───────────────────────────────────────────
dev: ## Run server + UI in dev mode (hot-reload)
	@echo "Starting server (tsx watch) + UI (vite)..."
	@npx concurrently -n server,ui -c blue,magenta \
		"npm run dev" \
		"cd ui && npm run dev" \
	2>/dev/null || (echo "=> concurrently not found, starting server only"; npm run dev)

dev-server: ## Run server only in dev mode
	npm run dev

dev-ui: ## Run UI only in dev mode
	cd ui && npm run dev

# ─── Build ───────────────────────────────────────────────
build: ## Build server + UI for production
	npm run build

build-server: ## Build server only (tsc)
	npm run build:server

build-ui: ## Build UI only (vite)
	npm run build:ui

start: build ## Build and start production server
	npm run start

# ─── Docker ──────────────────────────────────────────────
docker-up: env ## Start with Docker Compose
	$(COMPOSE) up -d

docker-down: ## Stop Docker Compose
	$(COMPOSE) down

docker-rebuild: env ## Rebuild and restart Docker
	$(COMPOSE) up -d --build

docker-logs: ## Tail Docker logs
	$(COMPOSE) logs -f

docker-restart: ## Restart Docker container
	$(COMPOSE) restart

docker-status: ## Show Docker container status
	$(COMPOSE) ps

# ─── Quality ─────────────────────────────────────────────
lint: ## Run ESLint on server code
	npm run lint

check: ## Type-check server + UI without emitting
	npx tsc --noEmit
	cd ui && npx tsc --noEmit

# ─── Clean / Reset ──────────────────────────────────────
clean: ## Remove build artifacts (dist/)
	rm -rf dist ui/dist

clean-deps: ## Remove all node_modules
	rm -rf node_modules ui/node_modules

reset-db: ## Delete local SQLite database
	rm -f data/logserver.db data/logserver.db-shm data/logserver.db-wal

reset: clean clean-deps reset-db ## Full reset: artifacts + deps + DB
	@echo "Reset complete. Run 'make install' to re-setup."

nuke: reset ## Full reset + remove Docker volumes
	$(COMPOSE) down -v 2>/dev/null || true
	@echo "Nuked. Run 'make install' to re-setup."
