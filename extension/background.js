/**
 * Service worker RealityWall (Manifest V3, Chrome et Firefox).
 *
 * Gère deux déclencheurs équivalents :
 * - le menu contextuel "Débunker avec RealityWall" (clic droit, desktop
 *   uniquement : l'API contextMenus n'a pas d'équivalent tactile) ;
 * - un clic sur l'icône de la barre d'outils, qui analyse la sélection de
 *   texte courante. C'est le seul chemin utilisable sur Firefox pour
 *   Android, qui ne supporte pas contextMenus.
 *
 * Appelle directement l'API Anthropic avec la clé fournie par
 * l'utilisateur dans la page de réglages (BYOK) : aucun backend
 * intermédiaire, la clé ne quitte jamais l'appareil de l'utilisateur si ce
 * n'est vers api.anthropic.com.
 */

if (typeof importScripts === "function") {
  // Service worker classique (Chrome) : prompts.js et core.js ne sont pas
  // chargés via le tableau "scripts" du manifest, contrairement à Firefox.
  importScripts("prompts.js", "core.js");
}

const api = typeof browser !== "undefined" ? browser : chrome;

const MENU_ID = "reality-wall-debunk";
const MENU_ID_PAGE = "reality-wall-debunk-page";

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.create({
    id: MENU_ID,
    title: "Débunker avec RealityWall",
    contexts: ["selection"],
  });
  api.contextMenus.create({
    id: MENU_ID_PAGE,
    title: "Débunker toute la page avec RealityWall",
    contexts: ["page"],
  });
});

async function getSettings() {
  const stored = await api.storage.local.get({
    anthropicApiKey: "",
    model: DEFAULT_MODEL,
    webSearch: true,
  });
  return {
    apiKey: String(stored.anthropicApiKey || "").trim(),
    model: stored.model || DEFAULT_MODEL,
    webSearch: stored.webSearch !== false,
  };
}

async function notifyContentScript(tabId, message) {
  try {
    await api.tabs.sendMessage(tabId, message);
  } catch (error) {
    console.warn("RealityWall: impossible de contacter le content script.", error);
  }
}

async function analyzeAndNotify(text, tab) {
  if (!tab || typeof tab.id !== "number") {
    return;
  }

  const cleaned = text.trim();
  if (!cleaned) {
    return;
  }

  const { apiKey, model, webSearch } = await getSettings();
  if (!apiKey) {
    await notifyContentScript(tab.id, {
      type: "REALITYWALL_ERROR",
      message:
        "Aucune clé API Anthropic configurée. Ouvrez les réglages de l'extension pour en renseigner une.",
    });
    await api.runtime.openOptionsPage();
    return;
  }

  await notifyContentScript(tab.id, { type: "REALITYWALL_LOADING" });

  const truncated = cleaned.length > MAX_INPUT_CHARS ? cleaned.slice(0, MAX_INPUT_CHARS) : cleaned;

  try {
    const result = await callAnthropic(apiKey, truncated, tab.url || null, { model, webSearch });
    await notifyContentScript(tab.id, { type: "REALITYWALL_RESULT", payload: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await notifyContentScript(tab.id, { type: "REALITYWALL_ERROR", message });
  }
}

async function getSelectionText(tabId) {
  try {
    const results = await api.scripting.executeScript({
      target: { tabId },
      func: () => window.getSelection?.().toString() ?? "",
    });
    return results?.[0]?.result || "";
  } catch (error) {
    console.warn("RealityWall: impossible de lire la sélection de la page.", error);
    return "";
  }
}

async function getPageText(tabId) {
  try {
    const results = await api.scripting.executeScript({
      target: { tabId },
      func: () => document.body?.innerText ?? "",
    });
    return results?.[0]?.result || "";
  } catch (error) {
    console.warn("RealityWall: impossible de lire le contenu de la page.", error);
    return "";
  }
}

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_ID) {
    await analyzeAndNotify(info.selectionText || "", tab);
    return;
  }
  if (info.menuItemId === MENU_ID_PAGE) {
    if (!tab || typeof tab.id !== "number") {
      return;
    }
    const pageText = await getPageText(tab.id);
    await analyzeAndNotify(pageText, tab);
  }
});

// Clic sur l'icône de la barre d'outils : analyse la sélection en cours sur
// la page si elle existe, sinon la page entière. Seul déclencheur
// disponible là où contextMenus n'existe pas (Firefox pour Android).
// Fonctionne aussi sur desktop, en complément du clic droit.
api.action.onClicked.addListener(async (tab) => {
  if (!tab || typeof tab.id !== "number") {
    return;
  }

  const selectionText = await getSelectionText(tab.id);
  if (selectionText.trim()) {
    await analyzeAndNotify(selectionText, tab);
    return;
  }

  const pageText = await getPageText(tab.id);
  await analyzeAndNotify(pageText, tab);
});
