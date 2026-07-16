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
  // Service worker classique (Chrome) : prompts.js n'est pas chargé via le
  // tableau "scripts" du manifest, contrairement à Firefox.
  importScripts("prompts.js");
}

const api = typeof browser !== "undefined" ? browser : chrome;

const MENU_ID = "reality-wall-debunk";
const MENU_ID_PAGE = "reality-wall-debunk-page";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MODEL = "claude-sonnet-5";
const MAX_INPUT_CHARS = 4000;
const MAX_SEARCH_TOKENS = 2048;
const MAX_OUTPUT_TOKENS = 1024;

const STATUT_VALUES = ["Vrai", "Faux", "Incomplet", "Raccourci", "Hors-sujet"];
const RHETORIQUE_VALUES = [
  "Ad Hominem / Association",
  "Homme de Paille (Strawman)",
  "Faux Dilemme",
  "Diversion / Esquive",
];

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

async function getApiKey() {
  const { anthropicApiKey } = await api.storage.local.get({
    anthropicApiKey: "",
  });
  return anthropicApiKey.trim();
}

async function notifyContentScript(tabId, message) {
  try {
    await api.tabs.sendMessage(tabId, message);
  } catch (error) {
    console.warn("RealityWall: impossible de contacter le content script.", error);
  }
}

/** Valide la sortie du modèle par rapport au contrat à quatre axes. */
function validateRealityCheckResult(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Réponse du modèle non conforme : objet attendu.");
  }
  if (!STATUT_VALUES.includes(data.statut)) {
    throw new Error(`Réponse du modèle non conforme : statut invalide "${data.statut}".`);
  }
  if (!Array.isArray(data.rhetorique)) {
    throw new Error("Réponse du modèle non conforme : rhetorique doit être une liste.");
  }
  for (const item of data.rhetorique) {
    if (!item || !RHETORIQUE_VALUES.includes(item.type) || typeof item.explication !== "string" || !item.explication) {
      throw new Error("Réponse du modèle non conforme : élément rhetorique invalide.");
    }
  }
  if (!data.contexte || typeof data.contexte.probleme_detecte !== "boolean") {
    throw new Error("Réponse du modèle non conforme : contexte invalide.");
  }
  if (typeof data.contexte.explication !== "string") {
    throw new Error("Réponse du modèle non conforme : contexte.explication invalide.");
  }
  if (!Array.isArray(data.sources)) {
    throw new Error("Réponse du modèle non conforme : sources doit être une liste.");
  }
  for (const item of data.sources) {
    if (!item || typeof item.url !== "string" || !item.url || typeof item.description !== "string" || !item.description) {
      throw new Error("Réponse du modèle non conforme : élément sources invalide.");
    }
  }
  return data;
}

function friendlyApiError(status, body) {
  const apiMessage = body && body.error && body.error.message ? body.error.message : "";
  if (status === 401) {
    if (apiMessage.includes("anthropic-dangerous-direct-browser-access")) {
      return `Erreur de configuration de l'extension (en-tête manquant) : ${apiMessage}`;
    }
    return "Clé API Anthropic invalide ou manquante. Vérifiez-la dans les réglages de l'extension.";
  }
  if (status === 429) {
    return "Limite de débit de l'API Anthropic atteinte. Réessayez dans quelques instants.";
  }
  if (status === 402 || status === 403) {
    return `Accès refusé par l'API Anthropic (${status}) : ${apiMessage || "vérifiez votre compte et vos crédits."}`;
  }
  return `Erreur API Anthropic (${status}) : ${apiMessage || "réponse inattendue."}`;
}

function extractToolInput(responseBody) {
  const blocks = Array.isArray(responseBody.content) ? responseBody.content : [];
  for (const block of blocks) {
    if (block.type === "tool_use" && block.name === TOOL_NAME) {
      return block.input;
    }
  }
  throw new Error("Le modèle n'a pas renvoyé d'analyse structurée.");
}

async function postMessages(apiKey, body) {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });

  const parsed = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(friendlyApiError(response.status, parsed));
  }
  return parsed;
}

/**
 * Deux appels successifs : le premier laisse le modèle chercher librement
 * de vraies sources via web_search (tool_choice auto), le second force
 * l'appel de submit_reality_check une fois les recherches terminées, pour
 * que le champ sources cite des URLs réellement trouvées plutôt qu'une
 * simple requête de recherche inventée.
 */
async function callAnthropic(apiKey, text, sourceUrl) {
  const messages = [{ role: "user", content: buildUserPrompt(text, sourceUrl) }];

  const searchBody = await postMessages(apiKey, {
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_SEARCH_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [WEB_SEARCH_TOOL],
    messages,
  });

  messages.push({ role: "assistant", content: searchBody.content });
  messages.push({ role: "user", content: buildFinalizePrompt() });

  const finalBody = await postMessages(apiKey, {
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [REALITY_CHECK_TOOL],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages,
  });

  return validateRealityCheckResult(extractToolInput(finalBody));
}

async function analyzeAndNotify(text, tab) {
  if (!tab || typeof tab.id !== "number") {
    return;
  }

  const cleaned = text.trim();
  if (!cleaned) {
    return;
  }

  const apiKey = await getApiKey();
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
    const result = await callAnthropic(apiKey, truncated, tab.url || null);
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
