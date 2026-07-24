# Reader - developer task runner.
# Run `make` or `make help` to see available targets.

# Use bash and fail fast.
SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

# Compose files
COMPOSE_DEV := docker/docker-compose.dev.yml
COMPOSE_PROD := docker/docker-compose.yml
# The prod stack reads secrets from the repo-root .env. Compose otherwise looks
# for .env next to the compose file (docker/.env), so point it at the root one
# explicitly - this is needed even for `down`, which still interpolates the file.
COMPOSE_PROD_CMD := docker compose --env-file .env -f $(COMPOSE_PROD)

.PHONY: help
help: ## Show this help
	@echo "Reader - available make targets:"
	@echo ""
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
	@echo ""

# --- Setup -----------------------------------------------------------------

.PHONY: setup
setup: env install ## First-time setup: create .env then install deps

.PHONY: install
install: ## Install all workspace dependencies
	pnpm install

.PHONY: env
env: ## Create .env from .env.example with a generated SESSION_SECRET (if missing)
	@if [ -f .env ]; then \
		echo ".env already exists, leaving it untouched."; \
	else \
		secret=$$(openssl rand -hex 32); \
		sed "s/^SESSION_SECRET=.*/SESSION_SECRET=$$secret/" .env.example > .env; \
		echo "Created .env with a fresh SESSION_SECRET."; \
	fi

# --- Development -----------------------------------------------------------

.PHONY: dev
dev: ## Run web + api in watch mode (Turborepo)
	pnpm dev

.PHONY: dev-worker
dev-worker: ## Run the feed-polling worker in watch mode
	pnpm --filter @rss/api dev:worker

# --- Database --------------------------------------------------------------

.PHONY: db-up
db-up: ## Start the local dev Postgres container
	docker compose -f $(COMPOSE_DEV) up -d
	@echo "Waiting for Postgres to be healthy..."
	@until [ "$$(docker inspect --format '{{.State.Health.Status}}' rss-reader-dev-db-1 2>/dev/null)" = "healthy" ]; do sleep 1; done
	@echo "Postgres is ready."

.PHONY: db-down
db-down: ## Stop the local dev Postgres container (keeps data)
	docker compose -f $(COMPOSE_DEV) down

.PHONY: db-generate
db-generate: ## Generate Drizzle SQL migrations from the schema
	pnpm db:generate

.PHONY: db-migrate
db-migrate: ## Apply pending migrations to the database
	pnpm db:migrate

.PHONY: db-studio
db-studio: ## Open Drizzle Studio
	pnpm db:studio

.PHONY: db-reset
db-reset: ## DESTROY and recreate the dev database, then migrate
	docker compose -f $(COMPOSE_DEV) down -v
	$(MAKE) db-up
	$(MAKE) db-migrate

# --- Quality gates ---------------------------------------------------------

.PHONY: lint
lint: ## Lint the whole workspace
	pnpm lint

.PHONY: format
format: ## Format all files with Prettier
	pnpm format

.PHONY: format-check
format-check: ## Check formatting without writing
	pnpm format:check

.PHONY: typecheck
typecheck: ## Type-check the whole workspace
	pnpm typecheck

.PHONY: test
test: ## Run unit tests
	pnpm test

.PHONY: test-integration
test-integration: ## Run API integration tests (needs Docker)
	pnpm test:integration

.PHONY: check
check: lint typecheck test test-integration ## Run lint + typecheck + unit + integration tests

.PHONY: ci
ci: install lint typecheck test test-integration build ## Mirror the CI pipeline locally

.PHONY: build
build: ## Build all packages
	pnpm build

# --- Docker (full stack) ---------------------------------------------------

.PHONY: docker-build
docker-build: ## Build the production image
	docker build -f docker/Dockerfile -t rss-reader .

.PHONY: up
up: ## Start the full stack (Postgres + api + worker) in the background
	$(COMPOSE_PROD_CMD) up -d --build

.PHONY: down
down: ## Stop the full stack (keeps data)
	$(COMPOSE_PROD_CMD) down

.PHONY: logs
logs: ## Tail logs from the full stack
	$(COMPOSE_PROD_CMD) logs -f

# --- Housekeeping ----------------------------------------------------------

.PHONY: clean
clean: ## Remove build artifacts and caches
	rm -rf .turbo apps/*/dist packages/*/dist apps/*/.turbo packages/*/.turbo

.PHONY: clean-all
clean-all: clean ## Remove build artifacts AND all node_modules
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
