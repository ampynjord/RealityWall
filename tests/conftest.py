"""Fixtures partagées pour la suite de tests RealityWall."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest

from backend.config import Settings
from backend.engine import RealityWallEngine
from backend.prompts import TOOL_NAME


class FakeMessagesResource:
    """Simule `client.messages` de l'AsyncAnthropic SDK.

    `queue` contient une liste de payloads (dict = input d'outil valide,
    Exception = erreur à lever, None = réponse sans bloc tool_use) consommés
    dans l'ordre à chaque appel de `create`.
    """

    def __init__(self, queue: list[Any]) -> None:
        self._queue = list(queue)
        self.calls: list[dict[str, Any]] = []
        self.create = AsyncMock(side_effect=self._create)

    async def _create(self, **kwargs: Any) -> SimpleNamespace:
        self.calls.append(kwargs)
        if not self._queue:
            raise AssertionError("FakeMessagesResource: file d'attente épuisée")

        item = self._queue.pop(0)
        if isinstance(item, Exception):
            raise item
        if item is None:
            return SimpleNamespace(content=[SimpleNamespace(type="text", text="désolé")])

        block = SimpleNamespace(type="tool_use", name=TOOL_NAME, input=item)
        return SimpleNamespace(content=[block])


class FakeAsyncAnthropic:
    """Simule `AsyncAnthropic` en exposant uniquement `.messages.create`."""

    def __init__(self, queue: list[Any]) -> None:
        self.messages = FakeMessagesResource(queue)


def make_engine(queue: list[Any], **settings_overrides: Any) -> tuple[RealityWallEngine, FakeAsyncAnthropic]:
    settings = Settings(anthropic_api_key="test-key", **settings_overrides)
    fake_client = FakeAsyncAnthropic(queue)
    engine = RealityWallEngine(settings=settings, client=fake_client)
    return engine, fake_client


@pytest.fixture
def valid_tool_output() -> dict[str, Any]:
    return {
        "statut": "Raccourci",
        "rhetorique": [
            {
                "type": "Ad Hominem / Association",
                "explication": "Attaque la source plutôt que l'argument.",
            }
        ],
        "contexte": {
            "probleme_detecte": True,
            "explication": "Chiffre brut non ajusté à l'inflation.",
        },
        "verification": "INSEE indice des prix à la consommation",
    }
