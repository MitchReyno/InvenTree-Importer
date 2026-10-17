.PHONY: test test-scanner test-all

test:
	uv run pytest -m "not tui"

test-scanner:
	uv run --extra scanner pytest -m tui

test-all:
	uv run --extra scanner pytest -m ""
