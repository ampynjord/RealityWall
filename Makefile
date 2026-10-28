.PHONY: help test icons

help:
	@echo "RealityWall — cibles disponibles :"
	@echo "  make test    Lance les tests de l'extension (Node 20+, aucun appel réseau)"
	@echo "  make icons   Régénère les icônes PNG de l'extension"

test:
	node --test test/*.test.js

icons:
	python3 scripts/generate_icons.py
