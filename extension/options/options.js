/**
 * Logique de la page de réglages : clé API Anthropic fournie par
 * l'utilisateur (BYOK), modèle, recherche web, médias, réponse suggérée.
 * Tout est stocké dans chrome.storage.local (jamais synchronisé entre
 * appareils) ; la clé ne transite que vers api.anthropic.com.
 */

const api = typeof browser !== "undefined" ? browser : chrome;

const DEFAULTS = {
  anthropicApiKey: "",
  model: "claude-sonnet-5",
  webSearch: true,
  useMedia: true,
  reply: true,
  replyStyle: "court",
  selectionButton: true,
};

const form = document.getElementById("options-form");
const keyInput = document.getElementById("api-key");
const modelSelect = document.getElementById("model");
const webSearchInput = document.getElementById("web-search");
const useMediaInput = document.getElementById("use-media");
const replyInput = document.getElementById("reply");
const replyStyleSelect = document.getElementById("reply-style");
const selectionButtonInput = document.getElementById("selection-button");
const toggleButton = document.getElementById("toggle-key");
const testButton = document.getElementById("test-key");
const status = document.getElementById("status");

function setStatus(message, isError = false) {
  status.textContent = message;
  status.className = `rw-status ${isError ? "rw-status-error" : "rw-status-ok"}`;
}

function syncReplyControls() {
  replyStyleSelect.disabled = !replyInput.checked;
}

toggleButton.addEventListener("click", () => {
  const showing = keyInput.type === "text";
  keyInput.type = showing ? "password" : "text";
  toggleButton.textContent = showing ? "Afficher" : "Masquer";
});

testButton.addEventListener("click", async () => {
  const value = keyInput.value.trim();
  if (!value) {
    setStatus("Saisissez d'abord une clé API.", true);
    return;
  }
  testButton.disabled = true;
  setStatus("Vérification de la clé…");
  try {
    await testApiKey(value);
    setStatus("Clé valide ✓ — pensez à enregistrer.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    testButton.disabled = false;
  }
});

replyInput.addEventListener("change", syncReplyControls);

async function loadOptions() {
  const stored = await api.storage.local.get(DEFAULTS);
  keyInput.value = stored.anthropicApiKey;
  modelSelect.value = stored.model;
  webSearchInput.checked = stored.webSearch !== false;
  useMediaInput.checked = stored.useMedia !== false;
  replyInput.checked = stored.reply !== false;
  replyStyleSelect.value = stored.replyStyle === "detaille" ? "detaille" : "court";
  selectionButtonInput.checked = stored.selectionButton !== false;
  syncReplyControls();
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
    useMedia: useMediaInput.checked,
    reply: replyInput.checked,
    replyStyle: replyStyleSelect.value,
    selectionButton: selectionButtonInput.checked,
  });
  setStatus("Réglages enregistrés.");
});

loadOptions();
