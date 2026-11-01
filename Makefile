.PHONY: dev build typecheck lint lint-backend lint-frontend test test-backend test-frontend test-scanner test-all workflow-sync

dev:
	pnpm dev

build:
	pnpm build

typecheck:
	pnpm typecheck

lint: lint-backend lint-frontend

lint-backend:
	cd backend && uv run ruff check --config pyproject.toml . ../.agents/skills ../.claude/skills

lint-frontend:
	pnpm lint:frontend

test: test-backend test-frontend

test-backend:
	cd backend && uv run pytest -m "not tui"

test-frontend:
	pnpm test:frontend

test-scanner:
	cd backend && uv run --extra scanner pytest -m tui

test-all:
	cd backend && uv run --extra scanner pytest -m ""
	pnpm test:frontend

workflow-sync:
	cd backend && uv run pytest tests/test_project_workflow_sync.py
