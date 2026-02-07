.PHONY: setup migrate makemigrations run test lint format shell createsuperuser createcachetable

setup:
	uv sync --group dev
	cp -n .env.example .env || true
	@echo "Setup complete. Edit .env with your local settings."

migrate:
	cd backend && uv run python manage.py migrate

makemigrations:
	cd backend && uv run python manage.py makemigrations

run:
	cd backend && uv run python manage.py runserver

test:
	uv run pytest

lint:
	uv run ruff check backend/

format:
	uv run ruff format backend/

shell:
	cd backend && uv run python manage.py shell

createsuperuser:
	cd backend && uv run python manage.py createsuperuser

createcachetable:
	cd backend && uv run python manage.py createcachetable
