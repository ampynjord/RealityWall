"""Point d'entrée FastAPI du backend RealityWall.

Expose un unique endpoint métier `/analyze` consommé par l'extension
navigateur. La clé API Anthropic ne quitte jamais ce processus serveur :
le frontend ne la connaît jamais et communique uniquement avec cette API.
"""

from __future__ import annotations

import logging

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .engine import RealityWallEngine, RealityWallError
from .schemas import AnalyseRequest, RealityCheckResult

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("realitywall.api")

settings = get_settings()

app = FastAPI(
    title="RealityWall API",
    description=(
        "Moteur d'analyse factuelle et rhétorique neutre pour l'extension "
        "navigateur RealityWall."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

_engine = RealityWallEngine(settings=settings)


def get_engine() -> RealityWallEngine:
    """Fournisseur de dépendance FastAPI, substituable dans les tests."""

    return _engine


@app.get("/health")
async def health() -> dict[str, str]:
    """Vérification de disponibilité, utilisée par le Makefile et l'extension."""

    return {"status": "ok"}


@app.post("/analyze", response_model=RealityCheckResult)
async def analyze(
    payload: AnalyseRequest,
    engine: RealityWallEngine = Depends(get_engine),
) -> RealityCheckResult:
    """Analyse un texte sélectionné et renvoie le verdict structuré."""

    try:
        return await engine.analyze(payload.text, payload.url)
    except RealityWallError as exc:
        logger.warning("Analyse refusée : %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
