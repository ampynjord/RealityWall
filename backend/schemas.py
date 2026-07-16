"""Modèles Pydantic définissant le contrat de données de RealityWall."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

Statut = Literal["Vrai", "Faux", "Incomplet", "Raccourci", "Hors-sujet"]

RhetoriqueType = Literal[
    "Ad Hominem / Association",
    "Homme de Paille (Strawman)",
    "Faux Dilemme",
    "Diversion / Esquive",
]


class RhetoriqueItem(BaseModel):
    """Un sophisme de mauvaise foi détecté dans le texte analysé."""

    type: RhetoriqueType
    explication: str = Field(min_length=1)


class Contexte(BaseModel):
    """Analyse du cherry-picking et des variables de contexte omises."""

    probleme_detecte: bool
    explication: str = ""


class AnalyseRequest(BaseModel):
    """Corps de la requête POST /analyze envoyée par l'extension."""

    text: str = Field(min_length=1, max_length=8000)
    url: str | None = None

    @field_validator("text")
    @classmethod
    def text_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Le texte ne peut pas être composé uniquement d'espaces.")
        return value


class RealityCheckResult(BaseModel):
    """Sortie structurée du moteur d'analyse RealityWall."""

    statut: Statut
    rhetorique: list[RhetoriqueItem] = Field(default_factory=list)
    contexte: Contexte
    verification: str = ""
