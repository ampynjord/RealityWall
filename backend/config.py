"""Configuration centralisée du backend RealityWall.

Toutes les valeurs sont lisibles depuis l'environnement (ou un fichier .env
à la racine du projet) afin de ne jamais coder en dur de secrets dans le
code source.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_CORS_ORIGIN_REGEX = (
    r"^(chrome-extension|moz-extension)://.*$"
    r"|^https?://localhost(:\d+)?$"
    r"|^https?://127\.0\.0\.1(:\d+)?$"
)


class Settings(BaseSettings):
    """Paramètres d'exécution du backend, chargés depuis l'environnement."""

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5"

    host: str = "0.0.0.0"
    port: int = 8000

    cors_origin_regex: str = DEFAULT_CORS_ORIGIN_REGEX

    max_input_chars: int = 4000
    max_output_tokens: int = 1024
    request_timeout_seconds: float = 30.0

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    """Retourne une instance mise en cache des paramètres d'exécution."""

    return Settings()
