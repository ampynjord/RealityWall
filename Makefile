PYTHON ?= python3
VENV := .venv
PIP := $(VENV)/bin/pip
PY := $(VENV)/bin/python
UVICORN := $(VENV)/bin/uvicorn
PYTEST := $(VENV)/bin/pytest

.PHONY: help install test run icons lint clean

help:
	@echo "RealityWall — cibles disponibles :"
	@echo "  make install  Crée le venv, installe les dépendances, prépare .env"
	@echo "  make test     Lance la suite de tests pytest"
	@echo "  make run      Démarre le backend FastAPI (http://localhost:8000)"
	@echo "  make icons    Régénère les icônes PNG de l'extension"
	@echo "  make clean    Supprime le venv et les caches"

$(VENV)/bin/python:
	$(PYTHON) -m venv $(VENV)

install: $(VENV)/bin/python
	$(PIP) install --upgrade pip -q
	$(PIP) install -q -r backend/requirements-dev.txt
	@test -f .env || cp .env.example .env
	@echo "Prêt. Renseignez ANTHROPIC_API_KEY dans .env avant de lancer 'make run'."

test: install
	$(PYTEST)

run: install
	$(UVICORN) backend.main:app --host 0.0.0.0 --port 8000 --reload

icons: $(VENV)/bin/python
	$(PY) scripts/generate_icons.py

clean:
	rm -rf $(VENV) .pytest_cache
	find . -type d -name "__pycache__" -exec rm -rf {} +
