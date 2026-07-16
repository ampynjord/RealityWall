"""Tests du moteur RealityWallEngine, avec un client Anthropic simulé."""

from __future__ import annotations

import anthropic
import pytest

from backend.engine import RealityWallError
from backend.schemas import RealityCheckResult
from tests.conftest import make_engine
from tests.fixtures.bad_faith_samples import SAMPLES


async def test_analyze_returns_validated_result(valid_tool_output: dict) -> None:
    engine, fake_client = make_engine([valid_tool_output])

    result = await engine.analyze("Un commentaire quelconque.")

    assert isinstance(result, RealityCheckResult)
    assert result.statut == "Raccourci"
    call_kwargs = fake_client.messages.calls[0]
    assert call_kwargs["temperature"] == 0.0
    assert call_kwargs["tool_choice"] == {"type": "tool", "name": "submit_reality_check"}


async def test_analyze_rejects_empty_text() -> None:
    engine, _ = make_engine([])

    with pytest.raises(RealityWallError):
        await engine.analyze("   ")


async def test_analyze_rejects_whitespace_only_text() -> None:
    engine, _ = make_engine([])

    with pytest.raises(RealityWallError):
        await engine.analyze("\n\t  \n")


async def test_analyze_truncates_overly_long_text(valid_tool_output: dict) -> None:
    engine, fake_client = make_engine([valid_tool_output], max_input_chars=10)

    await engine.analyze("x" * 100)

    sent_prompt = fake_client.messages.calls[0]["messages"][0]["content"]
    assert "x" * 100 not in sent_prompt
    assert "x" * 10 in sent_prompt


async def test_analyze_raises_when_no_tool_use_block() -> None:
    engine, _ = make_engine([None])

    with pytest.raises(RealityWallError, match="analyse structurée"):
        await engine.analyze("Un texte quelconque.")


async def test_analyze_raises_on_invalid_schema() -> None:
    engine, _ = make_engine([{"statut": "Peut-être", "rhetorique": [], "contexte": {}, "verification": ""}])

    with pytest.raises(RealityWallError, match="schéma"):
        await engine.analyze("Un texte quelconque.")


class _FakeAPIError(anthropic.APIError):
    """Sous-classe minimale évitant la construction lourde du SDK réel."""

    def __init__(self, message: str = "connexion refusée") -> None:
        Exception.__init__(self, message)


async def test_analyze_wraps_api_error() -> None:
    engine, _ = make_engine([_FakeAPIError()])

    with pytest.raises(RealityWallError, match="Erreur API Anthropic"):
        await engine.analyze("Un texte quelconque.")


async def test_analyze_forwards_source_url(valid_tool_output: dict) -> None:
    engine, fake_client = make_engine([valid_tool_output])

    await engine.analyze("Un texte.", source_url="https://example.com/post/42")

    sent_prompt = fake_client.messages.calls[0]["messages"][0]["content"]
    assert "https://example.com/post/42" in sent_prompt


@pytest.mark.parametrize("sample", SAMPLES, ids=[s["id"] for s in SAMPLES])
async def test_engine_survives_bad_faith_samples_without_crashing(sample: dict) -> None:
    """Le moteur ne doit jamais planter sur des cas réels de mauvaise foi.

    Chaque échantillon simule la réponse que renverrait le modèle pour un
    commentaire de mauvaise foi typique (ad hominem, strawman, faux
    dilemme, diversion, cherry-picking...) et vérifie que le pipeline
    complet extrait un JSON valide de bout en bout.
    """

    engine, _ = make_engine([sample["tool_output"]])

    result = await engine.analyze(sample["text"])

    assert isinstance(result, RealityCheckResult)
    assert result.statut in {"Vrai", "Faux", "Incomplet", "Raccourci", "Hors-sujet"}
