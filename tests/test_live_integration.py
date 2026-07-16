"""Test d'intégration optionnel effectuant un vrai appel à l'API Anthropic.

Désactivé par défaut (nécessite une clé API valide et engage des coûts).
Pour l'exécuter : `REALITYWALL_RUN_LIVE_TESTS=1 pytest -m integration`.
"""

from __future__ import annotations

import os

import pytest

from backend.config import Settings
from backend.engine import RealityWallEngine
from backend.schemas import RealityCheckResult

pytestmark = pytest.mark.integration

RUN_LIVE = os.environ.get("REALITYWALL_RUN_LIVE_TESTS") == "1"


@pytest.mark.skipif(not RUN_LIVE, reason="Test live désactivé (REALITYWALL_RUN_LIVE_TESTS != 1)")
async def test_live_analyze_ad_hominem() -> None:
    settings = Settings()
    if not settings.anthropic_api_key:
        pytest.skip("ANTHROPIC_API_KEY absente de l'environnement")

    engine = RealityWallEngine(settings=settings)
    result = await engine.analyze(
        "De toute façon t'es de gauche donc ton avis sur l'économie ne "
        "vaut rien."
    )

    assert isinstance(result, RealityCheckResult)
    assert any(item.type == "Ad Hominem / Association" for item in result.rhetorique)
