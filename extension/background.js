/**
 * Service worker RealityWall (Manifest V3, Chrome et Firefox).
 *
 * Déclencheurs, tous équivalents (le contexte est collecté par le content
 * script, qui renvoie ici un contexte complet à analyser) :
 * - menus contextuels (clic droit, desktop uniquement) : sélection, page
 *   entière, image ou vidéo ;
 * - clic sur l'icône de la barre d'outils : sélection courante, sinon page
 *   entière — seul chemin sur Firefox pour Android ;
 * - raccourci clavier Alt+Maj+R ;
 * - bouton flottant affiché près d'une sélection (content script).
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
const MENU_ID_MEDIA = "reality-wall-debunk-media";

// Analyses en cours, par onglet : permet d'annuler depuis la pop-up.
const inflight = new Map();

api.runtime.onInstalled.addListener((details) => {
  if (api.contextMenus) {
    api.contextMenus.create({
      id: MENU_ID,
      title: "Débunker avec RealityWall",
      contexts: ["selection"],
    });
    api.contextMenus.create({
      id: MENU_ID_MEDIA,
      title: "Débunker ce média avec RealityWall",
      contexts: ["image", "video"],
    });
    api.contextMenus.create({
      id: MENU_ID_PAGE,
      title: "Débunker toute la page avec RealityWall",
      contexts: ["page"],
    });
  }
  // Première installation : on guide vers la saisie de la clé.
  if (details && details.reason === "install") {
    api.runtime.openOptionsPage();
  }
});

async function getSettings() {
  const stored = await api.storage.local.get({
    anthropicApiKey: "",
    model: DEFAULT_MODEL,
    webSearch: true,
    reply: true,
    replyStyle: "court",
  });
  return {
    apiKey: String(stored.anthropicApiKey || "").trim(),
    model: stored.model || DEFAULT_MODEL,
    webSearch: stored.webSearch !== false,
    reply: stored.reply !== false,
    replyStyle: stored.replyStyle === "detaille" ? "detaille" : "court",
  };
}

async function notifyContentScript(tabId, message) {
  try {
    await api.tabs.sendMessage(tabId, message);
  } catch (error) {
    console.warn("RealityWall: impossible de contacter le content script.", error);
  }
}

/**
 * S'assure que le content script est présent dans l'onglet (onglets
 * ouverts avant l'installation de l'extension) en l'injectant au besoin.
 */
async function ensureContentScript(tabId) {
  try {
    await api.tabs.sendMessage(tabId, { type: "REALITYWALL_PING" });
    return true;
  } catch (error) {
    try {
      await api.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
      await api.scripting.executeScript({ target: { tabId }, files: ["context.js", "content.js"] });
      return true;
    } catch (injectError) {
      console.warn("RealityWall: page inaccessible à l'extension.", injectError);
      return false;
    }
  }
}

async function startOnTab(tab, mode, extra = {}) {
  if (!tab || typeof tab.id !== "number") {
    return;
  }
  if (!(await ensureContentScript(tab.id))) {
    return;
  }
  await notifyContentScript(tab.id, { type: "REALITYWALL_START", mode, ...extra });
}

/** Analyse un contexte collecté par le content script et affiche le verdict. */
async function runAnalysis(context, tab, fresh) {
  if (!tab || typeof tab.id !== "number" || !context || typeof context !== "object") {
    return;
  }
  const tabId = tab.id;

  const settings = await getSettings();
  if (!settings.apiKey) {
    await notifyContentScript(tabId, {
      type: "REALITYWALL_ERROR",
      message:
        "Aucune clé API Anthropic configurée. Ouvrez les réglages de l'extension pour en renseigner une.",
    });
    await api.runtime.openOptionsPage();
    return;
  }

  const previous = inflight.get(tabId);
  if (previous) {
    previous.abort();
  }
  const controller = new AbortController();
  inflight.set(tabId, controller);

  try {
    const result = await callAnthropic(settings.apiKey, context, {
      model: settings.model,
      webSearch: settings.webSearch,
      reply: settings.reply,
      replyStyle: settings.replyStyle,
      fresh: Boolean(fresh),
      signal: controller.signal,
    });
    if (inflight.get(tabId) === controller) {
      await notifyContentScript(tabId, { type: "REALITYWALL_RESULT", payload: result });
    }
  } catch (error) {
    if (error && error.name === "AbortError") {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    await notifyContentScript(tabId, { type: "REALITYWALL_ERROR", message });
  } finally {
    if (inflight.get(tabId) === controller) {
      inflight.delete(tabId);
    }
  }
}

api.runtime.onMessage.addListener((message, sender) => {
  if (!message || typeof message.type !== "string") {
    return;
  }
  if (message.type === "REALITYWALL_ANALYZE") {
    // Un seul expéditeur légitime : le content script de l'extension.
    if (sender && sender.id === api.runtime.id && sender.tab) {
      runAnalysis(message.context, sender.tab, message.fresh);
    }
  } else if (message.type === "REALITYWALL_CANCEL") {
    const controller = sender && sender.tab ? inflight.get(sender.tab.id) : null;
    if (controller) {
      controller.abort();
      inflight.delete(sender.tab.id);
    }
  } else if (message.type === "REALITYWALL_OPEN_OPTIONS") {
    api.runtime.openOptionsPage();
  }
});

if (api.contextMenus) {
  api.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === MENU_ID) {
      await startOnTab(tab, "selection");
    } else if (info.menuItemId === MENU_ID_PAGE) {
      await startOnTab(tab, "page");
    } else if (info.menuItemId === MENU_ID_MEDIA) {
      await startOnTab(tab, "media", { srcUrl: info.srcUrl });
    }
  });
}

// Clic sur l'icône de la barre d'outils : analyse la sélection en cours sur
// la page si elle existe, sinon la page entière. Seul déclencheur
// disponible là où contextMenus n'existe pas (Firefox pour Android).
api.action.onClicked.addListener(async (tab) => {
  await startOnTab(tab, "auto");
});

// Raccourci clavier (Alt+Maj+R par défaut, modifiable par l'utilisateur).
if (api.commands && api.commands.onCommand) {
  api.commands.onCommand.addListener(async (command, tab) => {
    if (command !== "analyze") {
      return;
    }
    let target = tab;
    if (!target || typeof target.id !== "number") {
      [target] = await api.tabs.query({ active: true, currentWindow: true });
    }
    await startOnTab(target, "auto");
  });
}
