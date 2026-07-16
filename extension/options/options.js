/**
 * Logique de la page de réglages : stockage de l'URL du backend et
 * demande de permission d'hôte optionnelle si l'URL n'est pas locale.
 */

const api = typeof browser !== "undefined" ? browser : chrome;

const DEFAULT_BACKEND_URL = "https://realitywall.ampynjord.bzh";

const form = document.getElementById("options-form");
const urlInput = document.getElementById("backend-url");
const status = document.getElementById("status");

function setStatus(message, isError = false) {
  status.textContent = message;
  status.className = `rw-status ${isError ? "rw-status-error" : "rw-status-ok"}`;
}

function originPatternFor(url) {
  const parsed = new URL(url);
  const port = parsed.port ? `:${parsed.port}` : "";
  return `${parsed.protocol}//${parsed.hostname}${port}/*`;
}

async function loadOptions() {
  const { backendUrl } = await api.storage.sync.get({
    backendUrl: DEFAULT_BACKEND_URL,
  });
  urlInput.value = backendUrl;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const value = urlInput.value.trim().replace(/\/+$/, "");

  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    setStatus("URL invalide.", true);
    return;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    setStatus("Le protocole doit être http ou https.", true);
    return;
  }

  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";

  if (!isLocal) {
    const origin = originPatternFor(value);
    const granted = await api.permissions.request({ origins: [origin] });
    if (!granted) {
      setStatus("Permission refusée pour cette origine, réglage non enregistré.", true);
      return;
    }
  }

  await api.storage.sync.set({ backendUrl: value });
  setStatus("Réglages enregistrés.");
});

loadOptions();
