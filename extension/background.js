/**
 * Service worker RealityWall (Manifest V3).
 *
 * Gère le menu contextuel "Débunker avec RealityWall" et la communication
 * avec le backend d'analyse. La clé API Anthropic ne transite jamais ici :
 * ce script ne fait qu'un POST vers le backend local que l'utilisateur a
 * démarré, et relaie le résultat au content script pour affichage.
 */

const MENU_ID = "reality-wall-debunk";
const DEFAULT_BACKEND_URL = "http://localhost:8000";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Débunker avec RealityWall",
    contexts: ["selection"],
  });
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

async function getBackendUrl() {
  const { backendUrl } = await chrome.storage.sync.get({
    backendUrl: DEFAULT_BACKEND_URL,
  });
  return backendUrl.replace(/\/+$/, "");
}

async function notifyContentScript(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    console.warn("RealityWall: impossible de contacter le content script.", error);
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab || typeof tab.id !== "number") {
    return;
  }

  const text = (info.selectionText || "").trim();
  if (!text) {
    return;
  }

  await notifyContentScript(tab.id, { type: "REALITYWALL_LOADING" });

  try {
    const backendUrl = await getBackendUrl();
    const response = await fetch(`${backendUrl}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, url: tab.url || null }),
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
});
