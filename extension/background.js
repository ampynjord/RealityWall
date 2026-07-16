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
 * La clé API Anthropic ne transite jamais ici : ce script ne fait qu'un
 * POST vers le backend que l'utilisateur a démarré, et relaie le résultat
 * au content script pour affichage.
 */

const api = typeof browser !== "undefined" ? browser : chrome;

const MENU_ID = "reality-wall-debunk";
const DEFAULT_BACKEND_URL = "http://localhost:8000";

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.create({
    id: MENU_ID,
    title: "Débunker avec RealityWall",
    contexts: ["selection"],
  });
});

async function getBackendUrl() {
  const { backendUrl } = await api.storage.sync.get({
    backendUrl: DEFAULT_BACKEND_URL,
  });
  return backendUrl.replace(/\/+$/, "");
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

  await notifyContentScript(tab.id, { type: "REALITYWALL_LOADING" });

  try {
    const backendUrl = await getBackendUrl();
    const response = await fetch(`${backendUrl}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: cleaned, url: tab.url || null }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Le backend a répondu ${response.status} : ${errorBody}`);
    }

    const data = await response.json();
    await notifyContentScript(tab.id, { type: "REALITYWALL_RESULT", payload: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await notifyContentScript(tab.id, { type: "REALITYWALL_ERROR", message });
  }
}

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) {
    return;
  }
  await analyzeAndNotify(info.selectionText || "", tab);
});

// Clic sur l'icône de la barre d'outils : analyse la sélection en cours sur
// la page. Seul déclencheur disponible là où contextMenus n'existe pas
// (Firefox pour Android). Fonctionne aussi sur desktop, en complément du
// clic droit. Sans sélection, ouvre les réglages par défaut.
api.action.onClicked.addListener(async (tab) => {
  if (!tab || typeof tab.id !== "number") {
    return;
  }

  let selectionText = "";
  try {
    const results = await api.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection?.().toString() ?? "",
    });
    selectionText = results?.[0]?.result || "";
  } catch (error) {
    console.warn("RealityWall: impossible de lire la sélection de la page.", error);
  }

  if (!selectionText.trim()) {
    await api.runtime.openOptionsPage();
    return;
  }

  await analyzeAndNotify(selectionText, tab);
});
