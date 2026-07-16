"""Moteur d'analyse RealityWall : appel Claude en mode "tool use" forcé."""

from __future__ import annotations

import logging
from typing import Any

import anthropic
from anthropic import AsyncAnthropic

from .config import Settings, get_settings
from .prompts import REALITY_CHECK_TOOL, SYSTEM_PROMPT, TOOL_NAME, build_user_prompt
from .schemas import RealityCheckResult

logger = logging.getLogger("realitywall.engine")


class RealityWallError(RuntimeError):
    """Levée quand l'analyse n'a pas pu être produite ou validée."""


class RealityWallEngine:
    """Encapsule l'appel à l'API Claude et la validation de sa sortie."""

    def __init__(
        self,
        settings: Settings | None = None,
        client: AsyncAnthropic | None = None,
    ) -> None:
        self._settings = settings or get_settings()
        self._client = client or AsyncAnthropic(
            api_key=self._settings.anthropic_api_key,
            timeout=self._settings.request_timeout_seconds,
        )

    async def analyze(self, text: str, source_url: str | None = None) -> RealityCheckResult:
        """Analyse un texte et renvoie un résultat structuré et validé."""

        cleaned = text.strip()
        if not cleaned:
            raise RealityWallError("Le texte fourni est vide.")

        max_chars = self._settings.max_input_chars
        if len(cleaned) > max_chars:
            cleaned = cleaned[:max_chars]

        try:
            response = await self._client.messages.create(
                model=self._settings.anthropic_model,
                max_tokens=self._settings.max_output_tokens,
                temperature=0.0,
                system=SYSTEM_PROMPT,
                tools=[REALITY_CHECK_TOOL],
                tool_choice={"type": "tool", "name": TOOL_NAME},
                messages=[
                    {"role": "user", "content": build_user_prompt(cleaned, source_url)}
                ],
            )
        except anthropic.APIError as exc:
            logger.exception("Erreur API Anthropic")
            raise RealityWallError(f"Erreur API Anthropic : {exc}") from exc

        tool_input = self._extract_tool_input(response)

        try:
            return RealityCheckResult.model_validate(tool_input)
        except Exception as exc:  # pydantic.ValidationError, entre autres
            logger.exception("Réponse du modèle non conforme au schéma attendu")
            raise RealityWallError(
                f"Réponse du modèle non conforme au schéma : {exc}"
            ) from exc

    @staticmethod
    def _extract_tool_input(response: Any) -> dict:
        for block in response.content:
            if getattr(block, "type", None) == "tool_use" and block.name == TOOL_NAME:
                return block.input
        raise RealityWallError("Le modèle n'a pas renvoyé d'analyse structurée.")
