"""Tests de validation du contrat de données Pydantic."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from backend.schemas import AnalyseRequest, RealityCheckResult


def test_valid_result_round_trip(valid_tool_output: dict) -> None:
    result = RealityCheckResult.model_validate(valid_tool_output)
    assert result.statut == "Raccourci"
    assert result.rhetorique[0].type == "Ad Hominem / Association"
    assert result.contexte.probleme_detecte is True
    assert result.verification == "INSEE indice des prix à la consommation"


def test_empty_rhetorique_and_context_allowed() -> None:
    result = RealityCheckResult.model_validate(
        {
            "statut": "Vrai",
            "rhetorique": [],
            "contexte": {"probleme_detecte": False, "explication": ""},
            "verification": "Légifrance code du travail article",
        }
    )
    assert result.rhetorique == []
    assert result.contexte.probleme_detecte is False


def test_empty_verification_allowed_for_pure_opinion() -> None:
    result = RealityCheckResult.model_validate(
        {
            "statut": "Hors-sujet",
            "rhetorique": [],
            "contexte": {"probleme_detecte": False, "explication": ""},
            "verification": "",
        }
    )
    assert result.verification == ""


@pytest.mark.parametrize(
    "invalid_statut",
    ["vrai", "FAUX", "Correct", "", "Vrai "],
)
def test_invalid_statut_rejected(invalid_statut: str, valid_tool_output: dict) -> None:
    payload = {**valid_tool_output, "statut": invalid_statut}
    with pytest.raises(ValidationError):
        RealityCheckResult.model_validate(payload)


def test_invalid_rhetorique_type_rejected(valid_tool_output: dict) -> None:
    payload = {
        **valid_tool_output,
        "rhetorique": [{"type": "Sophisme Inconnu", "explication": "x"}],
    }
    with pytest.raises(ValidationError):
        RealityCheckResult.model_validate(payload)


def test_missing_required_field_rejected(valid_tool_output: dict) -> None:
    payload = dict(valid_tool_output)
    del payload["contexte"]
    with pytest.raises(ValidationError):
        RealityCheckResult.model_validate(payload)


def test_analyse_request_rejects_empty_text() -> None:
    with pytest.raises(ValidationError):
        AnalyseRequest(text="")


def test_analyse_request_accepts_optional_url() -> None:
    request = AnalyseRequest(text="Un texte à analyser.")
    assert request.url is None
