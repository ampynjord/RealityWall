/**
 * Logique métier RealityWall, sans dépendance aux API d'extension
 * (chrome/browser) : appel à l'API Anthropic, validation de la sortie,
 * vérification des sources. Chargé après prompts.js (importScripts sur
 * Chrome, tableau "scripts" du manifest sur Firefox) et testable tel quel
 * sous Node (voir test/).
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// Modèles proposés. `dynamicSearch` : web_search_20260209 (filtrage dynamique)
// est documenté pour Sonnet 5.5 et Opus 5.5 ; les autres utilisent la
// version basique, disponible partout.
const MODELS = [
  { id: "claude-haiku-5-5", dynamicSearch: false },
  { id: "claude-sonnet-5-5", dynamicSearch: true },
  { id: "claude-opus-5-5", dynamicSearch: true },
  { id: "claude-fable-5-1", dynamicSearch: false },
];
const DEFAULT_MODEL = "claude-sonnet-5-5";
// Anciens identifiants enregistrés dans les réglages -> génération actuelle.
const LEGACY_MODELS = {
  "claude-haiku-4-5": "claude-haiku-5-5",
  "claude-sonnet-5": "claude-sonnet-5-5",
  "claude-opus-5": "claude-opus-5-5",
  "claude-fable-5": "claude-fable-5-1",
};
// Ces modèles réfléchissent toujours : `effort` règle le compromis
// vitesse / profondeur (les jetons de réflexion comptent dans max_tokens).
const ANALYSIS_EFFORT = "medium";
const MAX_INPUT_CHARS = 4000;
const MAX_CAPTION_CHARS = 3000;
const MAX_DESCRIPTION_CHARS = 500;
const MAX_IMAGES = 3;
const MAX_FRAME_BASE64_CHARS = 1500000;
const MAX_COMBINED_TOKENS = 12000;
const MAX_OUTPUT_TOKENS = 8000;
const MAX_REPLY_TOKENS = 4000;
const MAX_SOURCES = 3;
const MAX_RHETORIQUE = 3;
const MAX_REPLY_CHARS = 800;
const CACHE_MAX_ENTRIES = 50;

const STATUT_VALUES = ["Vrai", "Faux", "Incomplet", "Raccourci", "Hors-sujet"];
// Source unique : le catalogue de prompts.js (enum du schéma + prompt).
const RHETORIQUE_VALUES = RHETORIQUE_TYPES;

// Statuts HTTP transitoires pour lesquels un unique nouvel essai est tenté.
const RETRYABLE_STATUSES = [429, 500, 502, 503, 529];
let retryDelayMs = 1500;

// Sites dont les images ont été refusées à l'API (robots.txt, accès protégé...) :
// on ne les renvoie plus pendant la durée de vie du service worker.
const blockedImageHosts = new Set();

// Cache en mémoire (durée de vie du service worker) : relancer l'analyse du
// même texte avec les mêmes réglages ne coûte ni temps ni jetons.
const analysisCache = new Map();

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
    if (item.extrait !== undefined && typeof item.extrait !== "string") {
      throw new Error("Réponse du modèle non conforme : extrait invalide.");
    }
    item.extrait = item.extrait || "";
  }
  if (data.resume !== undefined && typeof data.resume !== "string") {
    throw new Error("Réponse du modèle non conforme : resume invalide.");
  }
  data.resume = data.resume || "";
  if (data.reponse_suggeree !== undefined && typeof data.reponse_suggeree !== "string") {
    throw new Error("Réponse du modèle non conforme : reponse_suggeree invalide.");
  }
  data.reponse_suggeree = data.reponse_suggeree || "";
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
  if (status === 529) {
    return "L'API Anthropic est surchargée. Réessayez dans quelques instants.";
  }
  if (status === 402 || status === 403) {
    return `Accès refusé par l'API Anthropic (${status}) : ${apiMessage || "vérifiez votre compte et vos crédits."}`;
  }
  return `Erreur API Anthropic (${status}) : ${apiMessage || "réponse inattendue."}`;
}

/** Retourne l'input de l'outil submit_reality_check, ou null s'il est absent. */
function tryExtractToolInput(responseBody) {
  const blocks = Array.isArray(responseBody && responseBody.content) ? responseBody.content : [];
  for (const block of blocks) {
    if (block && block.type === "tool_use" && block.name === TOOL_NAME) {
      return block.input ?? null;
    }
  }
  return null;
}

function extractToolInput(responseBody) {
  const input = tryExtractToolInput(responseBody);
  if (input === null) {
    throw new Error("Le modèle n'a pas renvoyé d'analyse structurée.");
  }
  return input;
}

/** Vrai pour une URL http(s) bien formée (refuse javascript:, data:, etc.). */
function isSafeHttpUrl(value) {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch (error) {
    return false;
  }
}

/** Forme comparable d'une URL : sans fragment, hôte en minuscules, sans "/" final. */
function normalizeUrl(value) {
  const url = new URL(value.trim());
  url.hash = "";
  return url.href.replace(/\/+$/, "");
}

/**
 * URLs réellement renvoyées par web_search dans une réponse : résultats de
 * recherche et citations du texte généré à partir d'eux.
 */
function collectSearchUrls(content) {
  const urls = new Set();
  if (!Array.isArray(content)) {
    return urls;
  }
  const add = (candidate) => {
    if (isSafeHttpUrl(candidate)) {
      urls.add(normalizeUrl(candidate));
    }
  };
  for (const block of content) {
    if (block?.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const result of block.content) {
        add(result?.url);
      }
    }
    if (Array.isArray(block?.citations)) {
      for (const citation of block.citations) {
        add(citation?.url);
      }
    }
  }
  return urls;
}

/**
 * Ne garde que les sources dont l'URL a réellement été renvoyée par la
 * recherche web (jamais une URL inventée par le modèle), au plus
 * MAX_SOURCES, sans doublon. Sans recherche effectuée, aucune source.
 */
function sanitizeSources(sources, allowedUrls) {
  if (!Array.isArray(sources) || !allowedUrls || allowedUrls.size === 0) {
    return [];
  }
  const seen = new Set();
  const kept = [];
  for (const source of sources) {
    if (!isSafeHttpUrl(source?.url)) {
      continue;
    }
    const key = normalizeUrl(source.url);
    if (!allowedUrls.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    kept.push({ url: source.url.trim(), description: source.description });
    if (kept.length >= MAX_SOURCES) {
      break;
    }
  }
  return kept;
}

/** Identifiant de modèle valide (migre les anciens réglages, défaut sinon). */
function normalizeModel(id) {
  const mapped = LEGACY_MODELS[id] || id;
  return MODELS.some((model) => model.id === mapped) ? mapped : DEFAULT_MODEL;
}

function getWebSearchTool(model) {
  const known = MODELS.find((entry) => entry.id === model);
  return known && known.dynamicSearch ? WEB_SEARCH_TOOL : WEB_SEARCH_TOOL_BASIC;
}

/** Résultats de recherche web d'une réponse ({ url, title }), 8 au plus. */
function collectSearchResults(content) {
  const results = [];
  const seen = new Set();
  for (const block of Array.isArray(content) ? content : []) {
    if (block?.type !== "web_search_tool_result" || !Array.isArray(block.content)) {
      continue;
    }
    for (const result of block.content) {
      if (!isSafeHttpUrl(result?.url) || seen.has(normalizeUrl(result.url))) {
        continue;
      }
      seen.add(normalizeUrl(result.url));
      results.push({ url: result.url.trim(), title: String(result.title || "").trim() });
    }
  }
  return results.slice(0, 8);
}

/** Refus du modèle (filtres de sécurité) : HTTP 200 mais stop_reason "refusal". */
function checkStopReason(body) {
  if (body && body.stop_reason === "refusal") {
    throw new Error(
      "Le modèle a refusé d'analyser ce contenu (filtre de sécurité). Essayez un autre modèle dans les réglages."
    );
  }
}

/** Ajoute un texte au contenu d'un message (chaîne ou liste de blocs). */
function appendText(content, text) {
  return typeof content === "string"
    ? `${content}\n\n${text}`
    : [...content, { type: "text", text }];
}

/** Coupe un texte à `max` caractères (sans casser la limite d'entrée de l'API). */
function clipText(value, max) {
  const text = String(value || "").trim();
  return text.length > max ? text.slice(0, max) : text;
}

/** Forme comparable d'un texte pour retrouver une citation (casse, espaces, apostrophes). */
function normalizeForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Efface la citation d'un procédé rhétorique si elle ne figure pas
 * réellement dans le contenu analysé (le procédé est conservé, mais on
 * n'affiche pas une citation que l'auteur n'a jamais écrite).
 */
function verifyExtraits(items, corpus) {
  const haystack = normalizeForMatch(corpus);
  for (const item of items) {
    const quote = normalizeForMatch(item.extrait).replace(/^[.…\s]+|[.…\s]+$/g, "");
    item.extrait = quote && haystack.includes(quote) ? item.extrait.trim() : "";
  }
  return items;
}

/** Retire toute URL de la réponse suggérée (le lien vérifié est ajouté par l'interface). */
function sanitizeReply(text) {
  return String(text || "")
    .replace(/(?:https?:\/\/|www\.)\S+/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_REPLY_CHARS);
}

/** Image de capture : data URL base64 jpeg/png/webp de taille raisonnable, sinon null. */
function parseFrameDataUrl(value) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ""));
  if (!match || match[2].length > MAX_FRAME_BASE64_CHARS) {
    return null;
  }
  return { media_type: match[1], data: match[2] };
}

/** Texte brut de tout ce qui a été analysé, pour vérifier les citations. */
function contextCorpus(context) {
  return [context.text, context.captions, context.pageTitle, context.description].filter(Boolean).join("\n");
}

/** Ce qui a réellement été pris en compte, affiché à l'utilisateur. */
function describeContext(context) {
  const used = [];
  const text = String(context.text || "");
  if (text) {
    used.push(`texte (${text.length} car.)`);
  }
  const images = Array.isArray(context.images) ? context.images.length : 0;
  if (images > 0) {
    used.push(`${images} image${images > 1 ? "s" : ""}`);
  }
  if (parseFrameDataUrl(context.frame)) {
    used.push("capture vidéo");
  }
  if (context.captions) {
    used.push(`sous-titres (${context.captions.length} car.)`);
  }
  return { used, notes: Array.isArray(context.notes) ? [...context.notes] : [] };
}

/** Contenu du message utilisateur : images (URL ou capture) puis texte. */
function buildUserContent(context, webSearch, reply) {
  const prompt = buildUserPrompt(context, webSearch, reply);
  const blocks = [];
  for (const url of (context.images || []).slice(0, MAX_IMAGES)) {
    if (isSafeHttpUrl(url)) {
      blocks.push({ type: "image", source: { type: "url", url } });
    }
  }
  const frame = parseFrameDataUrl(context.frame);
  if (frame) {
    blocks.push({ type: "image", source: { type: "base64", media_type: frame.media_type, data: frame.data } });
  }
  if (blocks.length === 0) {
    return prompt;
  }
  blocks.push({ type: "text", text: prompt });
  return blocks;
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch (error) {
    return "";
  }
}

/**
 * Erreur 400 due au téléchargement d'une image par l'API (« This URL is
 * disallowed by the website's robots.txt file », accès refusé, format...).
 */
function isImageFetchError(error) {
  return (
    error instanceof AnthropicError &&
    error.status === 400 &&
    /image|robots|download|fetch|\burl\b/i.test(error.apiMessage)
  );
}

/** Même contexte sans les images servies par URL (l'API peut ne pas pouvoir les télécharger). */
function withoutUrlImages(context) {
  return { ...context, images: [] };
}

class AnthropicError extends Error {
  constructor(message, status, apiMessage) {
    super(message);
    this.name = "AnthropicError";
    this.status = status;
    this.apiMessage = apiMessage || "";
  }
}

function abortedError() {
  const aborted = new Error("Analyse annulée.");
  aborted.name = "AbortError";
  return aborted;
}

/** Valeur du premier champ chaîne complet `"key": "..."` d'un JSON partiel, ou undefined. */
function extractPartialString(partialJson, key) {
  const match = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(partialJson);
  if (!match) {
    return undefined;
  }
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch (error) {
    return undefined;
  }
}

const STREAM_ERROR_STATUS = { overloaded_error: 529, rate_limit_error: 429, api_error: 500 };

/**
 * Lit une réponse en flux (SSE) et reconstitue le message ({ content,
 * stop_reason }). `onProgress` reçoit les étapes ("thinking", "searching",
 * "writing") et le verdict partiel ({ statut, resume }) dès qu'ils sont
 * complets dans l'appel d'outil en cours d'écriture.
 */
async function readMessageStream(response, onProgress, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const blocks = [];
  const emitted = new Set();
  let stopReason = null;
  let buffer = "";

  const stage = (name) => {
    if (!emitted.has(`stage:${name}`)) {
      emitted.add(`stage:${name}`);
      onProgress({ type: "stage", stage: name });
    }
  };

  const handle = (event) => {
    if (event.type === "content_block_start") {
      const block = { ...event.content_block };
      if (block.type === "tool_use" || block.type === "server_tool_use") {
        block.input = {};
        block.partialJson = "";
      }
      blocks[event.index] = block;
      if (block.type === "thinking" || block.type === "redacted_thinking") {
        stage("thinking");
      } else if (block.type === "server_tool_use") {
        stage("searching");
      } else if (block.type === "tool_use" && block.name === TOOL_NAME) {
        stage("writing");
      }
    } else if (event.type === "content_block_delta") {
      const block = blocks[event.index];
      const delta = event.delta || {};
      if (!block) {
        return;
      }
      if (delta.type === "text_delta") {
        block.text = (block.text || "") + delta.text;
      } else if (delta.type === "thinking_delta") {
        block.thinking = (block.thinking || "") + delta.thinking;
      } else if (delta.type === "signature_delta") {
        block.signature = delta.signature;
      } else if (delta.type === "citations_delta") {
        block.citations = [...(block.citations || []), delta.citation];
      } else if (delta.type === "input_json_delta") {
        block.partialJson += delta.partial_json;
        if (block.type === "tool_use" && block.name === TOOL_NAME) {
          const fields = {};
          for (const key of ["statut", "resume"]) {
            const value = extractPartialString(block.partialJson, key);
            if (value !== undefined && !emitted.has(`field:${key}`)) {
              emitted.add(`field:${key}`);
              fields[key] = value;
            }
          }
          if (Object.keys(fields).length > 0) {
            onProgress({ type: "partial", fields });
          }
        }
      }
    } else if (event.type === "content_block_stop") {
      const block = blocks[event.index];
      if (block && block.partialJson !== undefined) {
        try {
          block.input = block.partialJson ? JSON.parse(block.partialJson) : {};
        } catch (error) {
          block.input = {};
        }
        delete block.partialJson;
      }
    } else if (event.type === "message_delta") {
      stopReason = (event.delta && event.delta.stop_reason) || stopReason;
    } else if (event.type === "error") {
      const type = event.error && event.error.type;
      const status = STREAM_ERROR_STATUS[type] || 500;
      const message = event.error && event.error.message;
      throw new AnthropicError(friendlyApiError(status, { error: event.error }), status, message);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = raw
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");
        if (!data) {
          continue;
        }
        let event;
        try {
          event = JSON.parse(data);
        } catch (error) {
          continue;
        }
        handle(event);
      }
    }
  } catch (error) {
    if ((error && error.name === "AbortError") || (signal && signal.aborted)) {
      throw abortedError();
    }
    throw error;
  }
  return { content: blocks.filter(Boolean), stop_reason: stopReason };
}

/**
 * Appel à l'API Messages. Avec `onProgress`, la réponse est lue en flux
 * (étapes et verdict partiel affichés au fil de l'eau) ; sinon, en un bloc.
 */
async function postMessages(apiKey, body, signal, onProgress) {
  const streaming = typeof onProgress === "function";
  let attempt = 0;
  for (;;) {
    let response;
    try {
      response = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(streaming ? { ...body, stream: true } : body),
        signal,
      });
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw abortedError();
      }
      throw new Error("Impossible de joindre l'API Anthropic. Vérifiez votre connexion internet.");
    }

    if (response.ok) {
      if (streaming && response.body && typeof response.body.getReader === "function") {
        return readMessageStream(response, onProgress, signal);
      }
      return response.json();
    }

    const parsed = await response.json().catch(() => null);
    if (attempt === 0 && RETRYABLE_STATUSES.includes(response.status)) {
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }
    throw new AnthropicError(
      friendlyApiError(response.status, parsed),
      response.status,
      parsed && parsed.error && parsed.error.message
    );
  }
}

/** Vérifie une clé API avec un appel gratuit (liste des modèles). */
async function testApiKey(apiKey) {
  let response;
  try {
    response = await fetch(`${ANTHROPIC_API_URL.replace(/\/messages$/, "")}/models?limit=1`, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      },
    });
  } catch (error) {
    throw new Error("Impossible de joindre l'API Anthropic. Vérifiez votre connexion internet.");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(friendlyApiError(response.status, body));
  }
  return true;
}

function cacheGet(key) {
  if (!analysisCache.has(key)) {
    return undefined;
  }
  const value = analysisCache.get(key);
  analysisCache.delete(key);
  analysisCache.set(key, value);
  return value;
}

function cacheSet(key, value) {
  analysisCache.set(key, value);
  if (analysisCache.size > CACHE_MAX_ENTRIES) {
    analysisCache.delete(analysisCache.keys().next().value);
  }
}

/** Un ou deux appels API pour un contexte donné (voir callAnthropic). */
async function requestAnalysis(apiKey, context, options) {
  const model = normalizeModel(options.model);
  const webSearch = options.webSearch !== false;
  const reply = { enabled: options.reply !== false, style: options.replyStyle };
  const content = buildUserContent(context, webSearch, reply);
  const base = { model, system: SYSTEM_PROMPT, output_config: { effort: ANALYSIS_EFFORT } };

  // tool_choice reste "auto" : forcer un outil est refusé (400) par
  // Sonnet 5.5, Opus 5.5 et Fable 5.1. Le prompt demande l'appel de l'outil.
  const first = await postMessages(
    apiKey,
    {
      ...base,
      max_tokens: webSearch ? MAX_COMBINED_TOKENS : MAX_OUTPUT_TOKENS,
      tools: webSearch ? [getWebSearchTool(model), REALITY_CHECK_TOOL] : [REALITY_CHECK_TOOL],
      messages: [{ role: "user", content }],
    },
    options.signal,
    options.onProgress
  );
  checkStopReason(first);
  const searchedUrls = webSearch ? collectSearchUrls(first.content) : new Set();

  let toolInput = tryExtractToolInput(first);
  if (toolInput === null) {
    // Le modèle s'est arrêté sans finaliser (réponse tronquée, pause du tour
    // serveur, texte libre...). Nouvelle requête autonome — l'historique de la
    // première n'est pas rejoué (il contient des blocs de réflexion liés au
    // tour qui les a produits) — qui rappelle les résultats de recherche.
    const second = await postMessages(
      apiKey,
      {
        ...base,
        max_tokens: MAX_OUTPUT_TOKENS,
        tools: [REALITY_CHECK_TOOL],
        messages: [
          {
            role: "user",
            content: appendText(content, buildFinalizePrompt(webSearch ? collectSearchResults(first.content) : [])),
          },
        ],
      },
      options.signal,
      options.onProgress
    );
    checkStopReason(second);
    toolInput = extractToolInput(second);
  }

  const result = validateRealityCheckResult(toolInput);
  result.sources = webSearch ? sanitizeSources(result.sources, searchedUrls) : [];
  return result;
}

/**
 * Analyse un contexte : { mode, text, pageTitle, pageUrl, description,
 * captions, images[], frame, notes[] } (voir context.js).
 *
 * Avec recherche web : web_search est un outil serveur, sa recherche
 * s'exécute et le modèle reprend sa génération dans la MÊME réponse HTTP.
 * Les deux outils sont donc proposés dès le premier appel (tool_choice
 * auto) pour qu'il cherche puis appelle submit_reality_check en un seul
 * aller-retour. Si le modèle s'arrête après la recherche sans finaliser, une
 * seconde requête de secours (sans rejouer l'historique) lui redemande
 * l'outil, avec les résultats de recherche. Jamais de tool_choice forcé :
 * c'est refusé (400) par Sonnet 5.5, Opus 5.5 et Fable 5.1.
 *
 * Sans recherche web : un seul appel avec l'outil forcé (le plus rapide),
 * sans source.
 *
 * Dans tous les cas : sources filtrées sur les URLs réellement trouvées,
 * citations vérifiées dans le contenu, réponse suggérée sans URL, et — si
 * l'API ne peut pas télécharger une image — nouvelle tentative sans les
 * images servies par URL.
 */
async function callAnthropic(apiKey, rawContext, options = {}) {
  const requestedImages = Array.isArray(rawContext.images) ? rawContext.images.filter(isSafeHttpUrl) : [];
  const usableImages = requestedImages.filter((url) => !blockedImageHosts.has(hostnameOf(url)));
  const context = {
    ...rawContext,
    text: clipText(rawContext.text, MAX_INPUT_CHARS),
    captions: clipText(rawContext.captions, MAX_CAPTION_CHARS),
    description: clipText(rawContext.description, MAX_DESCRIPTION_CHARS),
    images: usableImages.slice(0, MAX_IMAGES),
    notes: Array.isArray(rawContext.notes) ? [...rawContext.notes] : [],
  };
  if (requestedImages.length > usableImages.length) {
    context.notes.push("Images ignorées : ce site interdit leur téléchargement par l'API.");
  }
  const model = normalizeModel(options.model);
  const webSearch = options.webSearch !== false;

  const cacheKey = JSON.stringify([
    model,
    webSearch,
    options.reply !== false,
    options.replyStyle || "court",
    context.mode || "selection",
    context.pageUrl || "",
    context.text,
    context.captions,
    context.images,
    context.frame ? context.frame.length : 0,
  ]);
  if (!options.fresh) {
    const cached = cacheGet(cacheKey);
    if (cached) {
      return cached;
    }
  }

  let used = context;
  let result;
  try {
    result = await requestAnalysis(apiKey, used, options);
  } catch (error) {
    if (!isImageFetchError(error) || used.images.length === 0) {
      throw error;
    }
    for (const url of used.images) {
      blockedImageHosts.add(hostnameOf(url));
    }
    used = withoutUrlImages(used);
    used.notes.push("Les images de la page n'ont pas pu être téléchargées par l'API (site qui les interdit) : analyse sans elles.");
    result = await requestAnalysis(apiKey, used, options);
  }

  verifyExtraits(result.rhetorique, contextCorpus(used));
  result.rhetorique = result.rhetorique.slice(0, MAX_RHETORIQUE);
  result.reponse_suggeree = options.reply === false ? "" : sanitizeReply(result.reponse_suggeree);
  result.meta = describeContext(used);
  result.meta.reply = options.reply !== false;

  cacheSet(cacheKey, result);
  return result;
}

/**
 * Régénère la réponse suggérée avec un autre ton ou une autre cible, à partir
 * d'une analyse déjà faite : un seul appel, sans recherche web, donc rapide.
 * options : { model, tone, target, replyStyle, signal }.
 */
async function callReply(apiKey, rawContext, analysis, options = {}) {
  const context = {
    ...rawContext,
    text: clipText(rawContext.text, MAX_INPUT_CHARS),
    captions: clipText(rawContext.captions, MAX_CAPTION_CHARS),
    description: clipText(rawContext.description, MAX_DESCRIPTION_CHARS),
  };
  const body = await postMessages(
    apiKey,
    {
      model: normalizeModel(options.model),
      max_tokens: MAX_REPLY_TOKENS,
      system: REPLY_SYSTEM_PROMPT,
      output_config: { effort: "low" },
      tools: [REPLY_TOOL],
      messages: [
        {
          role: "user",
          content: buildReplyPrompt(context, analysis, {
            tone: options.tone,
            target: options.target,
            style: options.replyStyle,
          }),
        },
      ],
    },
    options.signal
  );
  checkStopReason(body);

  const blocks = Array.isArray(body.content) ? body.content : [];
  const tool = blocks.find((block) => block && block.type === "tool_use" && block.name === REPLY_TOOL.name);
  const text = blocks.find((block) => block && block.type === "text" && block.text);
  const raw = tool && tool.input && typeof tool.input.reponse === "string" ? tool.input.reponse : text ? text.text : null;
  if (raw === null) {
    throw new Error("Le modèle n'a pas renvoyé de réponse.");
  }
  return sanitizeReply(raw);
}
