/**
 * Logique métier RealityWall, sans dépendance aux API d'extension
 * (chrome/browser) : appel à l'API Anthropic, validation de la sortie,
 * vérification des sources. Chargé après prompts.js (importScripts sur
 * Chrome, tableau "scripts" du manifest sur Firefox) et testable tel quel
 * sous Node (voir test/).
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_INPUT_CHARS = 4000;
const MAX_COMBINED_TOKENS = 2560;
const MAX_OUTPUT_TOKENS = 1024;
const MAX_SOURCES = 3;
const CACHE_MAX_ENTRIES = 50;

const STATUT_VALUES = ["Vrai", "Faux", "Incomplet", "Raccourci", "Hors-sujet"];
const RHETORIQUE_VALUES = [
  "Ad Hominem / Association",
  "Homme de Paille (Strawman)",
  "Faux Dilemme",
  "Diversion / Esquive",
];

// Statuts HTTP transitoires pour lesquels un unique nouvel essai est tenté.
const RETRYABLE_STATUSES = [429, 500, 502, 503, 529];
let retryDelayMs = 1500;

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

/**
 * web_search applique un filtrage dynamique qui exécute du code en
 * interne (code_execution) : un bloc server_tool_use doit toujours être
 * suivi de son bloc *_tool_result. Si la réponse est tronquée par
 * max_tokens en plein milieu d'un cycle de recherche, ce n'est pas
 * garanti — on retire alors les appels d'outil sans résultat avant de les
 * renvoyer, sous peine de 400 au tour suivant ("tool use ... was found
 * without a corresponding tool_result block").
 *
 * Les résultats d'outils serveur suivent tous la convention de nommage
 * `*_tool_result` (web_search_tool_result, code_execution_tool_result,
 * mcp_tool_result...) : on détecte par suffixe plutôt que par une liste
 * fermée de types, pour rester valide si Anthropic ajoute un nouveau type
 * d'outil serveur.
 */
function stripDanglingServerToolUse(content) {
  if (!Array.isArray(content)) {
    return content;
  }
  const resultIds = new Set(
    content
      .filter((block) => typeof block?.type === "string" && block.type.endsWith("_tool_result") && block.tool_use_id)
      .map((block) => block.tool_use_id)
  );
  return content.filter(
    (block) => !(block?.type === "server_tool_use" && !resultIds.has(block.id))
  );
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

/** web_search_20260209 (filtrage dynamique) n'existe pas sur Haiku. */
function getWebSearchTool(model) {
  return /haiku/i.test(model) ? WEB_SEARCH_TOOL_BASIC : WEB_SEARCH_TOOL;
}

async function postMessages(apiKey, body) {
  let attempt = 0;
  for (;;) {
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
    if (response.ok) {
      return parsed;
    }
    if (attempt === 0 && RETRYABLE_STATUSES.includes(response.status)) {
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }
    throw new Error(friendlyApiError(response.status, parsed));
  }
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

/**
 * Analyse un texte.
 *
 * Avec recherche web : web_search est un outil serveur, sa recherche
 * s'exécute et le modèle reprend sa génération dans la MÊME réponse HTTP.
 * Les deux outils sont donc proposés dès le premier appel (tool_choice
 * auto) pour qu'il cherche puis appelle submit_reality_check en un seul
 * aller-retour. Si le modèle s'arrête après la recherche sans finaliser, un
 * second appel de secours force l'appel de l'outil.
 *
 * Sans recherche web : un seul appel avec l'outil forcé (le plus rapide),
 * sans source.
 *
 * Dans tous les cas, les sources renvoyées sont filtrées sur les URLs
 * réellement trouvées par la recherche.
 */
async function callAnthropic(apiKey, text, sourceUrl, options = {}) {
  const model = options.model || DEFAULT_MODEL;
  const webSearch = options.webSearch !== false;

  const cacheKey = JSON.stringify([model, webSearch, sourceUrl || "", text]);
  const cached = cacheGet(cacheKey);
  if (cached) {
    return cached;
  }

  const messages = [{ role: "user", content: buildUserPrompt(text, sourceUrl, webSearch) }];

  let result;
  if (!webSearch) {
    const body = await postMessages(apiKey, {
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [REALITY_CHECK_TOOL],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages,
    });
    result = validateRealityCheckResult(extractToolInput(body));
    result.sources = [];
  } else {
    const combinedBody = await postMessages(apiKey, {
      model,
      max_tokens: MAX_COMBINED_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [getWebSearchTool(model), REALITY_CHECK_TOOL],
      messages,
    });
    const searchedUrls = collectSearchUrls(combinedBody.content);

    let toolInput = tryExtractToolInput(combinedBody);
    if (toolInput === null) {
      messages.push({
        role: "assistant",
        content: stripDanglingServerToolUse(combinedBody.content),
      });
      messages.push({ role: "user", content: buildFinalizePrompt() });

      const finalBody = await postMessages(apiKey, {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT,
        tools: [REALITY_CHECK_TOOL],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages,
      });
      toolInput = extractToolInput(finalBody);
    }

    result = validateRealityCheckResult(toolInput);
    result.sources = sanitizeSources(result.sources, searchedUrls);
  }

  cacheSet(cacheKey, result);
  return result;
}
