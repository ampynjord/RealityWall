"""Tests de l'API HTTP FastAPI, moteur métier remplacé par un double."""

from __future__ import annotations

from httpx import ASGITransport, AsyncClient

from backend.engine import RealityWallError
from backend.main import app, get_engine
from backend.schemas import RealityCheckResult


class StubEngine:
    def __init__(self, result: RealityCheckResult | None = None, error: Exception | None = None) -> None:
        self._result = result
        self._error = error
        self.received: tuple[str, str | None] | None = None

    async def analyze(self, text: str, source_url: str | None = None) -> RealityCheckResult:
        self.received = (text, source_url)
        if self._error is not None:
            raise self._error
        assert self._result is not None
        return self._result


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://testserver")


async def test_health_endpoint() -> None:
    async with await _client() as client:
        response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_analyze_endpoint_returns_result(valid_tool_output: dict) -> None:
    expected = RealityCheckResult.model_validate(valid_tool_output)
    stub = StubEngine(result=expected)
    app.dependency_overrides[get_engine] = lambda: stub

    try:
        async with await _client() as client:
            response = await client.post(
                "/analyze",
                json={"text": "Un commentaire à vérifier.", "url": "https://x.com/post/1"},
            )
    finally:
        app.dependency_overrides.pop(get_engine, None)

    assert response.status_code == 200
    assert response.json()["statut"] == expected.statut
    assert stub.received == ("Un commentaire à vérifier.", "https://x.com/post/1")


async def test_analyze_endpoint_rejects_empty_text() -> None:
    async with await _client() as client:
        response = await client.post("/analyze", json={"text": ""})
    assert response.status_code == 422


async def test_analyze_endpoint_rejects_missing_text_field() -> None:
    async with await _client() as client:
        response = await client.post("/analyze", json={})
    assert response.status_code == 422


async def test_analyze_endpoint_returns_502_on_engine_error() -> None:
    stub = StubEngine(error=RealityWallError("panne simulée"))
    app.dependency_overrides[get_engine] = lambda: stub

    try:
        async with await _client() as client:
            response = await client.post("/analyze", json={"text": "Un texte."})
    finally:
        app.dependency_overrides.pop(get_engine, None)

    assert response.status_code == 502
    assert "panne simulée" in response.json()["detail"]
