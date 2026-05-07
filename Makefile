.PHONY: help dev build test lint clean seed seed-real migrate infra-plan infra-apply deploy logs

# Default target
help:
	@echo ""
	@echo "  E-Commerce GenAI Lens — Developer Commands"
	@echo "  ─────────────────────────────────────────────"
	@echo "  make dev          Start local dev (API + docker services)"
	@echo "  make services     Start docker-compose services only"
	@echo "  make build        Build all packages"
	@echo "  make test         Run all tests"
	@echo "  make test-unit    Run unit tests only"
	@echo "  make test-int     Run integration tests"
	@echo "  make lint         Run ESLint + Prettier check"
	@echo "  make clean        Clean all build artifacts"
	@echo "  make seed         Seed database with mock data"
	@echo "  make seed-real    Seed with real OpenAI embeddings"
	@echo "  make migrate      Run database migrations"
	@echo "  make atlas-index  Create Atlas Search indexes"
	@echo "  make atlas-vector Create Atlas Vector Search index"
	@echo "  make backfill     Backfill product embeddings"
	@echo "  make logs         Tail docker-compose logs"
	@echo ""

# ─── Local Development ───────────────────────────────────────────────────────

dev: services
	@echo "==> Starting API in dev mode..."
	pnpm dev

services:
	@echo "==> Starting docker-compose services..."
	docker-compose up -d mongodb redis kafka localstack
	@echo "==> Waiting for services to be healthy..."
	@sleep 5
	@docker-compose ps

services-full:
	@echo "==> Starting all docker-compose services (including UIs)..."
	docker-compose up -d

services-stop:
	docker-compose down

services-clean:
	docker-compose down -v

logs:
	docker-compose logs -f

# ─── Build & Test ────────────────────────────────────────────────────────────

build:
	pnpm turbo run build

test:
	pnpm turbo run test

test-unit:
	pnpm turbo run test:unit

test-int:
	pnpm turbo run test:integration

lint:
	pnpm turbo run lint && pnpm format:check

check-types:
	pnpm turbo run check-types

clean:
	pnpm clean

install:
	pnpm install

# ─── Database ────────────────────────────────────────────────────────────────

seed: services
	@echo "==> Seeding database with mock data..."
	pnpm seed

seed-real: services
	@echo "==> Seeding database with real OpenAI embeddings..."
	pnpm seed:embeddings

migrate:
	@echo "==> Running database migrations..."
	pnpm migrate

atlas-index:
	@echo "==> Creating Atlas Search indexes..."
	pnpm atlas:index

atlas-vector:
	@echo "==> Creating Atlas Vector Search index..."
	pnpm atlas:vector

backfill:
	@echo "==> Backfilling product embeddings..."
	pnpm backfill

# ─── Infrastructure ──────────────────────────────────────────────────────────

infra-plan:
	@echo "==> Running terraform plan (dev)..."
	cd infra/terraform/environments/dev && terraform init && terraform plan

infra-apply:
	@echo "==> Applying terraform (dev)..."
	cd infra/terraform/environments/dev && terraform apply

deploy:
	@echo "==> Building Lambda artifacts and deploying..."
	pnpm build
	./scripts/deploy/build-lambdas.sh
	./scripts/deploy/upload-to-s3.sh
	./scripts/deploy/update-lambdas.sh

# ─── Utilities ───────────────────────────────────────────────────────────────

format:
	pnpm format

health:
	@curl -s http://localhost:3000/health | jq .

graphql-ping:
	@curl -s -X POST http://localhost:3000/graphql \
		-H 'Content-Type: application/json' \
		-d '{"query":"{ __typename }"}' | jq .
