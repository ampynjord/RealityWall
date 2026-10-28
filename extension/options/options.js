/**
 * Logique de la page de réglages : stockage local de la clé API
 * Anthropic fournie par l'utilisateur (BYOK), choix du modèle et de la
 * recherche web. La clé n'est jamais
 * synchronisée entre appareils (chrome.storage.local, pas .sync) et ne
 * transite que vers api.anthropic.com, jamais vers un tiers.
 */

const api = typeof browser !== "undefined" ? browser : chrome;

const form = document.getElementById("options-form");
const keyInput = document.getElementById("api-key");
const modelSelect = document.getElementById("model");
const webSearchInput = document.getElementById("web-search");
const toggleButton = document.getElementById("toggle-key");
const status = document.getElementById("status");

function setStatus(message, isError = false) {
  status.textContent = message;
  status.className = `rw-status ${isError ? "rw-status-error" : "rw-status-ok"}`;
}

toggleButton.addEventListener("click", () => {
  const showing = keyInput.type === "text";
  keyInput.type = showing ? "password" : "text";
  toggleButton.textContent = showing ? "Afficher" : "Masquer";
});

async function loadOptions() {
  const { anthropicApiKey, model, webSearch } = await api.storage.local.get({
    anthropicApiKey: "",
    model: "claude-sonnet-5",
    webSearch: true,
  });
  keyInput.value = anthropicApiKey;
  modelSelect.value = model;
  webSearchInput.checked = webSearch !== false;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const value = keyInput.value.trim();
  if (!value) {
    setStatus("La clé API ne peut pas être vide.", true);
    return;
  }

  await api.storage.local.set({
    anthropicApiKey: value,
    model: modelSelect.value,
    webSearch: webSearchInput.checked,
  });
  setStatus("Réglages enregistrés.");
});

loadOptions();
