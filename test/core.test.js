// Tests de la logique métier de l'extension (prompts.js + core.js), sans
// réseau : fetch est remplacé par un double dans un contexte vm isolé,
// exactement comme le service worker charge ces deux scripts.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXT = path.join(__dirname, "..", "extension");

function loadContext(fetchImpl) {
  const ctx = vm.createContext({ URL, console, setTimeout, Promise, JSON, AbortController, TextDecoder });
  ctx.fetch = fetchImpl;
  for (const file of ["prompts.js", "core.js"]) {
    vm.runInContext(fs.readFileSync(path.join(EXT, file), "utf8"), ctx, { filename: file });
  }
  vm.runInContext("retryDelayMs = 0;", ctx);
  return ctx;
}

const get = (ctx, expr) => vm.runInContext(expr, ctx);
// Les objets créés dans le contexte vm ont d'autres prototypes : on compare en JSON.
const plain = (value) => JSON.parse(JSON.stringify(value));

const VALID = {
  statut: "Faux",
  resume: "Le chiffre cité est inexact.",
  rhetorique: [
    { type: "Faux Dilemme", extrait: "soit on ferme, soit on meurt", explication: "Choix binaire artificiel." },
  ],
  contexte: { probleme_detecte: true, explication: "Période omise." },
  sources: [],
  reponse_suggeree: "Selon l'INSEE, le chiffre est de 7 %. Avez-vous une source pour 12 % ?",
};

const ctxOf = (text, extra = {}) => ({ mode: "selection", text, pageUrl: "https://page.example/p", ...extra });

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) };
}

/** Double de fetch qui rejoue des réponses dans l'ordre et enregistre les requêtes. */
function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const next = responses.shift();
    if (!next) throw new Error("fetch appelé plus de fois que prévu");
    return next;
  };
  fn.calls = calls;
  return fn;
}

const searchResult = (urls, id = "srv_1") => ({
  type: "web_search_tool_result",
  tool_use_id: id,
  content: urls.map((url) => ({ type: "web_search_result", url, title: url })),
});
const serverUse = (id) => ({ type: "server_tool_use", id, name: "web_search", input: { query: "q" } });
const submit = (input) => ({ type: "tool_use", id: "tu_1", name: "submit_reality_check", input });

// --- Catalogue et prompt -----------------------------------------------------

test("le catalogue de sophismes est cohérent entre schéma, prompt et validation", () => {
  const ctx = loadContext(async () => {});
  const catalog = plain(get(ctx, "RHETORIQUE_CATALOG"));
  assert.ok(catalog.length >= 18, "au moins 18 procédés");
  const types = catalog.map((entry) => entry.type);
  assert.equal(new Set(types).size, types.length, "types uniques");
  assert.ok(catalog.every((entry) => entry.definition.length > 30), "chaque procédé est défini");

  const enumValues = plain(get(ctx, "REALITY_CHECK_TOOL.input_schema.properties.rhetorique.items.properties.type.enum"));
  assert.deepEqual(enumValues, types);
  assert.deepEqual(plain(get(ctx, "RHETORIQUE_VALUES")), types);

  const prompt = get(ctx, "SYSTEM_PROMPT");
  for (const type of types) {
    assert.ok(prompt.includes(`"${type}"`), `prompt sans ${type}`);
  }
  assert.match(prompt, /précision prime sur l'exhaustivité/);
  assert.match(prompt, /MOT POUR MOT/);
  assert.match(prompt, /N'ÉCRIS JAMAIS d'URL/);
  assert.match(prompt, /Ne nomme jamais une personne d'après son visage/);
});

test("le schéma exige tous les champs de sortie", () => {
  const ctx = loadContext(async () => {});
  assert.deepEqual(plain(get(ctx, "REALITY_CHECK_TOOL.input_schema.required")), [
    "statut",
    "resume",
    "rhetorique",
    "contexte",
    "sources",
    "reponse_suggeree",
  ]);
});

test("buildUserPrompt décrit la cible, les médias et la réponse demandée", () => {
  const ctx = loadContext(async () => {});
  const build = get(ctx, "buildUserPrompt");
  const full = build(
    {
      mode: "page",
      text: "Texte du post",
      pageTitle: "Un post",
      pageUrl: "https://p.fr/x",
      description: "Desc",
      captions: "sous titres ici",
      images: ["https://img.example/a.jpg"],
      frame: "data:image/jpeg;base64,AAAA",
      notes: ["Pas de sous-titres."],
    },
    true,
    { enabled: true, style: "detaille" }
  );
  assert.match(full, /l'ensemble de la page/);
  assert.match(full, /Titre de la page : Un post/);
  assert.match(full, /<texte>\nTexte du post\n<\/texte>/);
  assert.match(full, /<soustitres>\nsous titres ici\n<\/soustitres>/);
  assert.match(full, /Images jointes : 2 \(dont une capture de la vidéo/);
  assert.match(full, /Limites du contexte : Pas de sous-titres\./);
  assert.match(full, /détaillée \(700 caractères/);
  assert.match(full, /Utilise web_search/);

  const off = build({ mode: "selection", text: "abc" }, false, { enabled: false });
  assert.match(off, /un message ou commentaire sélectionné/);
  assert.match(off, /recherche web est désactivée/);
  assert.match(off, /Réponse suggérée : désactivée/);
});

// --- Validation, citations, réponse ---------------------------------------------

test("validateRealityCheckResult accepte une sortie conforme et complète les champs optionnels", () => {
  const ctx = loadContext(async () => {});
  const fn = get(ctx, "validateRealityCheckResult");
  assert.equal(fn(structuredClone(VALID)).statut, "Faux");

  const minimal = fn({ statut: "Vrai", rhetorique: [], contexte: { probleme_detecte: false, explication: "" }, sources: [] });
  assert.equal(minimal.resume, "");
  assert.equal(minimal.reponse_suggeree, "");
});

test("validateRealityCheckResult rejette les sorties non conformes", () => {
  const ctx = loadContext(async () => {});
  const fn = get(ctx, "validateRealityCheckResult");
  const bad = [
    null,
    { ...VALID, statut: "Peut-être" },
    { ...VALID, rhetorique: "non" },
    { ...VALID, rhetorique: [{ type: "Inconnu", explication: "x" }] },
    { ...VALID, rhetorique: [{ type: "Faux Dilemme", explication: "x", extrait: 12 }] },
    { ...VALID, contexte: { probleme_detecte: "oui", explication: "" } },
    { ...VALID, sources: "non" },
    { ...VALID, sources: [{ url: "https://a.fr", description: "" }] },
    { ...VALID, resume: 12 },
    { ...VALID, reponse_suggeree: ["x"] },
  ];
  for (const data of bad) {
    assert.throws(() => fn(structuredClone(data)), /non conforme/);
  }
});

test("verifyExtraits n'affiche que des citations réellement présentes", () => {
  const ctx = loadContext(async () => {});
  const verify = get(ctx, "verifyExtraits");
  const items = verify(
    [
      { type: "Faux Dilemme", extrait: "Soit on  ferme,\nsoit on meurt", explication: "x" },
      { type: "Faux Dilemme", extrait: "phrase jamais écrite", explication: "x" },
      { type: "Faux Dilemme", extrait: "l’état  c’est moi", explication: "x" },
      { type: "Faux Dilemme", extrait: "", explication: "x" },
    ],
    "On le sait : soit on ferme, soit on meurt. L'état c'est moi."
  );
  assert.deepEqual(plain(items.map((i) => i.extrait)), ["Soit on  ferme,\nsoit on meurt", "", "l’état  c’est moi", ""]);
});

test("sanitizeReply retire toute URL et borne la longueur", () => {
  const ctx = loadContext(async () => {});
  const clean = get(ctx, "sanitizeReply");
  assert.equal(clean("Voir https://inventee.example/x et www.autre.fr pour le détail."), "Voir  et  pour le détail.".replace(/ {2}/g, " "));
  assert.equal(clean("  Bonjour\n\n\n\nMerci  "), "Bonjour\n\nMerci");
  assert.equal(clean("a".repeat(2000)).length, 800);
  assert.equal(clean(undefined), "");
});

test("isSafeHttpUrl refuse les schémas dangereux", () => {
  const ctx = loadContext(async () => {});
  const safe = get(ctx, "isSafeHttpUrl");
  assert.equal(safe("https://www.insee.fr/fr/statistiques"), true);
  assert.equal(safe("http://exemple.fr"), true);
  for (const url of ["javascript:alert(1)", "data:text/html,x", "ftp://a.fr", "pas une url", "", null, 42]) {
    assert.equal(safe(url), false, String(url));
  }
});

test("sanitizeSources ne garde que les URLs réellement trouvées par la recherche", () => {
  const ctx = loadContext(async () => {});
  const content = [
    serverUse("a"),
    searchResult(["https://www.insee.fr/fr/stat", "https://legifrance.gouv.fr/loda/"]),
    { type: "text", text: "x", citations: [{ url: "https://data.gouv.fr/page#frag" }] },
  ];
  const allowed = get(ctx, "collectSearchUrls")(content);
  const sanitize = get(ctx, "sanitizeSources");
  const out = sanitize(
    [
      { url: "https://www.insee.fr/fr/stat/", description: "vraie (slash final)" },
      { url: "https://www.insee.fr/fr/stat", description: "doublon" },
      { url: "https://inventee.example/xyz", description: "inventée" },
      { url: "javascript:alert(1)", description: "dangereuse" },
      { url: "https://data.gouv.fr/page", description: "via citation" },
      { url: "https://legifrance.gouv.fr/loda/", description: "troisième" },
      { url: "https://www.insee.fr/fr/stat", description: "quatrième" },
    ],
    allowed
  );
  assert.deepEqual(plain(out.map((s) => s.description)), ["vraie (slash final)", "via citation", "troisième"]);
  assert.deepEqual(plain(sanitize([{ url: "https://a.fr", description: "x" }], new Set())), []);
});

// --- Flux d'appel -----------------------------------------------------------------

test("recherche web : un seul appel, deux outils, résultat nettoyé", async () => {
  const fetchFn = fakeFetch([
    jsonResponse(200, {
      content: [
        serverUse("srv_1"),
        searchResult(["https://www.insee.fr/fr/stat"]),
        submit({
          ...VALID,
          rhetorique: [
            { type: "Faux Dilemme", extrait: "soit on ferme, soit on meurt", explication: "Choix binaire." },
            { type: "Pente Glissante", extrait: "citation inventée", explication: "Chaîne non démontrée." },
          ],
          sources: [
            { url: "https://www.insee.fr/fr/stat", description: "Réelle" },
            { url: "https://inventee.example", description: "Inventée" },
          ],
          reponse_suggeree: "Selon l'INSEE, c'est 7 %. Détails : https://inventee.example/y",
        }),
      ],
    }),
  ]);
  const ctx = loadContext(fetchFn);
  const result = await get(ctx, "callAnthropic")("clé", ctxOf("On le sait : soit on ferme, soit on meurt."), {});

  assert.equal(fetchFn.calls.length, 1);
  const { init, body } = fetchFn.calls[0];
  assert.equal(init.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(init.headers["x-api-key"], "clé");
  assert.equal(body.model, "claude-sonnet-5-5");
  assert.deepEqual(body.tools.map((t) => t.name), ["web_search", "submit_reality_check"]);
  assert.equal(body.tools[0].type, "web_search_20260209");
  assert.equal(body.tool_choice, undefined, "jamais de tool_choice forcé (400 sur les modèles 5.5)");
  assert.deepEqual(plain(body.output_config), { effort: "medium" });
  assert.equal(body.thinking, undefined, "la réflexion est gérée par le modèle");
  assert.ok(body.max_tokens >= 8000, "marge pour la réflexion");
  assert.equal(typeof body.messages[0].content, "string", "texte seul : contenu simple");

  assert.deepEqual(plain(result.sources.map((s) => s.description)), ["Réelle"]);
  assert.deepEqual(plain(result.rhetorique.map((r) => r.extrait)), ["soit on ferme, soit on meurt", ""]);
  assert.equal(result.reponse_suggeree, "Selon l'INSEE, c'est 7 %. Détails :");
  assert.deepEqual(plain(result.meta.used), [`texte (${"On le sait : soit on ferme, soit on meurt.".length} car.)`]);
});

test("contexte multimédia : images, capture vidéo et sous-titres sont envoyés", async () => {
  const fetchFn = fakeFetch([jsonResponse(200, { content: [submit(VALID)] })]);
  const ctx = loadContext(fetchFn);
  const result = await get(ctx, "callAnthropic")(
    "clé",
    ctxOf("Commentaire", {
      captions: "il dit que le chômage a doublé",
      images: ["https://img.example/a.jpg", "javascript:alert(1)", "https://img.example/b.png"],
      frame: "data:image/jpeg;base64,/9j/4AAQ",
      notes: ["Pas de sous-titres."],
    }),
    { webSearch: false }
  );

  const content = fetchFn.calls[0].body.messages[0].content;
  assert.ok(Array.isArray(content));
  assert.deepEqual(
    content.map((b) => b.type + ":" + (b.source ? b.source.type : "")),
    ["image:url", "image:url", "image:base64", "text:"]
  );
  assert.equal(content[0].source.url, "https://img.example/a.jpg");
  assert.equal(content[2].source.media_type, "image/jpeg");
  assert.equal(content[2].source.data, "/9j/4AAQ");
  assert.match(content[3].text, /il dit que le chômage a doublé/);
  assert.match(content[3].text, /Images jointes : 3/);
  assert.deepEqual(plain(result.meta.used), ["texte (11 car.)", "2 images", "capture vidéo", "sous-titres (30 car.)"]);
  assert.deepEqual(plain(result.meta.notes), ["Pas de sous-titres."]);
});

test("une capture invalide ou trop lourde est ignorée", async () => {
  const fetchFn = fakeFetch([jsonResponse(200, { content: [submit(VALID)] })]);
  const ctx = loadContext(fetchFn);
  await get(ctx, "callAnthropic")("clé", ctxOf("t", { frame: "data:text/html;base64,AAAA" }), { webSearch: false });
  assert.equal(typeof fetchFn.calls[0].body.messages[0].content, "string");
  assert.equal(get(ctx, "parseFrameDataUrl")("data:image/png;base64," + "A".repeat(1500001)), null);
});

test("si l'API ne peut pas télécharger une image, nouvel essai sans les images par URL", async () => {
  const fetchFn = fakeFetch([
    jsonResponse(400, { error: { message: "messages.0.content.0.image.source: unable to download the file" } }),
    jsonResponse(200, { content: [submit(VALID)] }),
  ]);
  const ctx = loadContext(fetchFn);
  const result = await get(ctx, "callAnthropic")(
    "clé",
    ctxOf("Commentaire", { images: ["https://img.example/a.jpg"], frame: "data:image/jpeg;base64,AAAA" }),
    { webSearch: false }
  );
  assert.equal(fetchFn.calls.length, 2);
  const retry = fetchFn.calls[1].body.messages[0].content;
  assert.deepEqual(retry.map((b) => b.type + ":" + (b.source ? b.source.type : "")), ["image:base64", "text:"]);
  assert.match(result.meta.notes[0], /images de la page n'ont pas pu être téléchargées/);
});

test("robots.txt : analyse refaite sans les images, et le site est ensuite ignoré", async () => {
  const robots = "This URL is disallowed by the website's robots.txt file.";
  const fetchFn = fakeFetch([
    jsonResponse(400, { error: { message: robots } }),
    jsonResponse(200, { content: [submit(VALID)] }),
    jsonResponse(200, { content: [submit(VALID)] }),
  ]);
  const ctx = loadContext(fetchFn);
  const call = get(ctx, "callAnthropic");
  const first = await call(
    "clé",
    ctxOf("Premier", { images: ["https://scontent.cdn.example/a.jpg"], frame: "data:image/jpeg;base64,AAAA" }),
    { webSearch: false }
  );
  assert.equal(fetchFn.calls.length, 2);
  assert.match(first.meta.notes[0], /site qui les interdit/);

  // Même site, autre analyse : l'image n'est même plus envoyée (pas d'aller-retour perdu).
  const second = await call(
    "clé",
    ctxOf("Second", { images: ["https://scontent.cdn.example/b.jpg", "https://autre.example/c.jpg"] }),
    { webSearch: false }
  );
  assert.equal(fetchFn.calls.length, 3);
  const urls = fetchFn.calls[2].body.messages[0].content.filter((b) => b.type === "image").map((b) => b.source.url);
  assert.deepEqual(urls, ["https://autre.example/c.jpg"]);
  assert.match(second.meta.notes[0], /Images ignorées/);
});

test("une erreur 400 sans rapport avec les images n'est pas retentée", async () => {
  const fetchFn = fakeFetch([jsonResponse(400, { error: { message: "max_tokens too large" } })]);
  await assert.rejects(
    get(loadContext(fetchFn), "callAnthropic")("clé", ctxOf("t", { images: ["https://img.example/a.jpg"] }), { webSearch: false }),
    /400/
  );
  assert.equal(fetchFn.calls.length, 1);
});

test("recherche web : requête de secours autonome si le modèle ne finalise pas", async () => {
  const fetchFn = fakeFetch([
    jsonResponse(200, {
      stop_reason: "pause_turn",
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        serverUse("srv_1"),
        {
          type: "web_search_tool_result",
          tool_use_id: "srv_1",
          content: [{ type: "web_search_result", url: "https://www.insee.fr/a", title: "INSEE — chômage" }],
        },
        serverUse("srv_dangling"),
      ],
    }),
    jsonResponse(200, {
      content: [submit({ ...VALID, sources: [{ url: "https://www.insee.fr/a", description: "Réelle" }] })],
    }),
  ]);
  const ctx = loadContext(fetchFn);
  const result = await get(ctx, "callAnthropic")("clé", ctxOf("texte B"), {});

  assert.equal(fetchFn.calls.length, 2);
  const second = fetchFn.calls[1].body;
  assert.equal(second.tool_choice, undefined, "pas de tool_choice forcé");
  assert.deepEqual(second.tools.map((t) => t.name), ["submit_reality_check"]);
  assert.equal(second.messages.length, 1, "l'historique (blocs de réflexion) n'est pas rejoué");
  assert.equal(second.messages[0].role, "user");
  assert.match(second.messages[0].content, /Appelle maintenant l'outil submit_reality_check/);
  assert.match(second.messages[0].content, /- INSEE — chômage — https:\/\/www\.insee\.fr\/a/);
  assert.match(second.messages[0].content, /texte B/);
  assert.equal(result.sources.length, 1);
});

test("sans recherche web : un seul appel, aucune source", async () => {
  const fetchFn = fakeFetch([
    jsonResponse(200, {
      content: [submit({ ...VALID, sources: [{ url: "https://inventee.example", description: "x" }] })],
    }),
  ]);
  const ctx = loadContext(fetchFn);
  const result = await get(ctx, "callAnthropic")("clé", ctxOf("texte C"), { webSearch: false });

  assert.equal(fetchFn.calls.length, 1);
  const { body } = fetchFn.calls[0];
  assert.deepEqual(body.tools.map((t) => t.name), ["submit_reality_check"]);
  assert.equal(body.tool_choice, undefined);
  assert.deepEqual(plain(result.sources), []);
});

test("réponse suggérée désactivée : toujours vide", async () => {
  const fetchFn = fakeFetch([jsonResponse(200, { content: [submit(VALID)] })]);
  const result = await get(loadContext(fetchFn), "callAnthropic")("clé", ctxOf("texte R"), { webSearch: false, reply: false });
  assert.equal(result.reponse_suggeree, "");
  assert.match(fetchFn.calls[0].body.messages[0].content, /Réponse suggérée : désactivée/);
});

test("au plus 3 procédés rhétoriques sont conservés", async () => {
  const many = ["Faux Dilemme", "Pente Glissante", "Tu Quoque / Whataboutism", "Procès d'Intention", "Appel à l'Émotion"].map(
    (type) => ({ type, extrait: "", explication: "x" })
  );
  const fetchFn = fakeFetch([jsonResponse(200, { content: [submit({ ...VALID, rhetorique: many })] })]);
  const result = await get(loadContext(fetchFn), "callAnthropic")("clé", ctxOf("texte M"), { webSearch: false });
  assert.equal(result.rhetorique.length, 3);
});

test("les quatre modèles 5.x sont proposés, avec le bon outil de recherche", async () => {
  const ctx = loadContext(async () => {});
  assert.deepEqual(plain(get(ctx, "MODELS.map((m) => m.id)")), [
    "claude-haiku-5-5",
    "claude-sonnet-5-5",
    "claude-opus-5-5",
    "claude-fable-5-1",
  ]);
  const toolType = (model) => get(ctx, `getWebSearchTool("${model}").type`);
  assert.equal(toolType("claude-sonnet-5-5"), "web_search_20260209");
  assert.equal(toolType("claude-opus-5-5"), "web_search_20260209");
  assert.equal(toolType("claude-haiku-5-5"), "web_search_20250305");
  assert.equal(toolType("claude-fable-5-1"), "web_search_20250305");

  for (const model of ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"]) {
    const fetchFn = fakeFetch([jsonResponse(200, { content: [submit(VALID)] })]);
    await get(loadContext(fetchFn), "callAnthropic")("clé", ctxOf("texte " + model), { model });
    assert.equal(fetchFn.calls[0].body.model, model);
    assert.equal(fetchFn.calls[0].body.tool_choice, undefined);
  }
});

test("normalizeModel migre les anciens réglages et refuse les valeurs inconnues", () => {
  const ctx = loadContext(async () => {});
  const norm = get(ctx, "normalizeModel");
  assert.equal(get(ctx, "DEFAULT_MODEL"), "claude-sonnet-5-5");
  assert.equal(norm("claude-sonnet-5"), "claude-sonnet-5-5");
  assert.equal(norm("claude-haiku-4-5"), "claude-haiku-5-5");
  assert.equal(norm("claude-opus-5"), "claude-opus-5-5");
  assert.equal(norm("claude-fable-5"), "claude-fable-5-1");
  assert.equal(norm("claude-opus-5-5"), "claude-opus-5-5");
  assert.equal(norm("gpt-n'importe-quoi"), "claude-sonnet-5-5");
  assert.equal(norm(undefined), "claude-sonnet-5-5");
});

test("un refus du modèle (stop_reason refusal) donne un message clair", async () => {
  const fetchFn = fakeFetch([jsonResponse(200, { stop_reason: "refusal", stop_details: { category: "general_harms" }, content: [] })]);
  await assert.rejects(
    get(loadContext(fetchFn), "callAnthropic")("clé", ctxOf("texte refus"), { webSearch: false }),
    /refusé d'analyser ce contenu/
  );
  assert.equal(fetchFn.calls.length, 1);
});

test("le cache évite un second appel identique, sauf demande de nouvelle analyse", async () => {
  const fetchFn = fakeFetch([
    jsonResponse(200, { content: [submit(VALID)] }),
    jsonResponse(200, { content: [submit({ ...VALID, resume: "Autre." })] }),
  ]);
  const ctx = loadContext(fetchFn);
  const call = get(ctx, "callAnthropic");
  const first = await call("clé", ctxOf("texte E"), { webSearch: false });
  const second = await call("clé", ctxOf("texte E"), { webSearch: false });
  assert.equal(fetchFn.calls.length, 1);
  assert.equal(second, first);

  const fresh = await call("clé", ctxOf("texte E"), { webSearch: false, fresh: true });
  assert.equal(fetchFn.calls.length, 2);
  assert.equal(fresh.resume, "Autre.");
});

test("une analyse peut être annulée", async () => {
  const controller = new AbortController();
  const fetchFn = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  const ctx = loadContext(fetchFn);
  ctx.controller = controller;
  const pending = get(ctx, "callAnthropic")("clé", ctxOf("texte annulé"), { webSearch: false, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error.name === "AbortError" && /annulée/.test(error.message));
});

test("erreurs API : messages explicites", async () => {
  const cors = fakeFetch([
    jsonResponse(401, { error: { message: "CORS requests must set 'anthropic-dangerous-direct-browser-access' header" } }),
  ]);
  await assert.rejects(
    get(loadContext(cors), "callAnthropic")("clé", ctxOf("t1"), { webSearch: false }),
    /en-tête manquant/
  );

  const badKey = fakeFetch([jsonResponse(401, { error: { message: "invalid x-api-key" } })]);
  await assert.rejects(
    get(loadContext(badKey), "callAnthropic")("clé", ctxOf("t2"), { webSearch: false }),
    /Clé API Anthropic invalide/
  );

  const noTool = fakeFetch([
    jsonResponse(200, { content: [{ type: "text", text: "bonjour" }] }),
    jsonResponse(200, { content: [{ type: "text", text: "toujours pas d'outil" }] }),
  ]);
  await assert.rejects(
    get(loadContext(noTool), "callAnthropic")("clé", ctxOf("t3"), { webSearch: false }),
    /analyse structurée/
  );

  const offline = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(
    get(loadContext(offline), "callAnthropic")("clé", ctxOf("t6"), { webSearch: false }),
    /Impossible de joindre l'API Anthropic/
  );
});

test("une erreur transitoire (529) est retentée une fois", async () => {
  const fetchFn = fakeFetch([
    jsonResponse(529, { error: { message: "overloaded" } }),
    jsonResponse(200, { content: [submit(VALID)] }),
  ]);
  const result = await get(loadContext(fetchFn), "callAnthropic")("clé", ctxOf("t4"), { webSearch: false });
  assert.equal(fetchFn.calls.length, 2);
  assert.equal(result.statut, "Faux");

  const always = fakeFetch([jsonResponse(529, {}), jsonResponse(529, {})]);
  await assert.rejects(
    get(loadContext(always), "callAnthropic")("clé", ctxOf("t5"), { webSearch: false }),
    /surchargée/
  );
});

test("testApiKey valide la clé via la liste des modèles", async () => {
  const ok = fakeFetch([jsonResponse(200, { data: [] })]);
  assert.equal(await get(loadContext(ok), "testApiKey")("clé"), true);
  assert.equal(ok.calls[0].url, "https://api.anthropic.com/v1/models?limit=1");
  assert.equal(ok.calls[0].init.method, "GET");
  assert.equal(ok.calls[0].init.headers["anthropic-dangerous-direct-browser-access"], "true");

  const bad = fakeFetch([jsonResponse(401, { error: { message: "invalid x-api-key" } })]);
  await assert.rejects(get(loadContext(bad), "testApiKey")("mauvaise"), /Clé API Anthropic invalide/);
});

// --- Manifest -----------------------------------------------------------------------

test("le manifest référence des fichiers existants, dans le bon ordre", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.background.scripts, ["prompts.js", "core.js", "background.js"]);
  assert.deepEqual(manifest.content_scripts[0].js, ["context.js", "content.js"]);
  assert.equal(manifest.commands.analyze.suggested_key.default, "Alt+Shift+R");

  const bg = fs.readFileSync(path.join(EXT, "background.js"), "utf8");
  assert.match(bg, /importScripts\("prompts\.js", "core\.js"\)/);
  assert.match(bg, /files: \["context\.js", "content\.js"\]/, "injection de secours alignée sur le manifest");

  const options = fs.readFileSync(path.join(EXT, "options", "options.html"), "utf8");
  assert.ok(options.indexOf("../prompts.js") < options.indexOf("../core.js"));
  assert.ok(options.indexOf("../core.js") < options.indexOf("options.js"));

  const files = [
    ...manifest.background.scripts,
    ...manifest.content_scripts.flatMap((c) => [...c.js, ...c.css]),
    manifest.options_ui.page,
    ...Object.values(manifest.icons),
  ];
  for (const file of files) {
    assert.ok(fs.existsSync(path.join(EXT, file)), `${file} manquant`);
  }
});

// --- Flux (SSE) : étapes et verdict partiel -----------------------------------------

/** Réponse HTTP en flux SSE, découpée en `chunkSize` octets pour tester le réassemblage. */
function sseResponse(events, chunkSize = 37) {
  const text = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (offset >= bytes.length) return { done: true, value: undefined };
          const value = bytes.slice(offset, offset + chunkSize);
          offset += chunkSize;
          return { done: false, value };
        },
      }),
    },
  };
}

const blockStart = (index, content_block) => ({ type: "content_block_start", index, content_block });
const blockDelta = (index, delta) => ({ type: "content_block_delta", index, delta });
const blockStop = (index) => ({ type: "content_block_stop", index });

function streamEvents(input) {
  const json = JSON.stringify(input);
  const cut = Math.floor(json.length / 3);
  return [
    { type: "message_start", message: { id: "m", content: [] } },
    blockStart(0, { type: "thinking", thinking: "" }),
    blockDelta(0, { type: "thinking_delta", thinking: "hmm" }),
    blockDelta(0, { type: "signature_delta", signature: "sig" }),
    blockStop(0),
    blockStart(1, { type: "server_tool_use", id: "srv_1", name: "web_search", input: {} }),
    blockDelta(1, { type: "input_json_delta", partial_json: '{"query":"chômage insee"}' }),
    blockStop(1),
    blockStart(2, {
      type: "web_search_tool_result",
      tool_use_id: "srv_1",
      content: [{ type: "web_search_result", url: "https://www.insee.fr/fr/stat", title: "INSEE" }],
    }),
    blockStop(2),
    { type: "ping" },
    blockStart(3, { type: "tool_use", id: "tu_1", name: "submit_reality_check", input: {} }),
    blockDelta(3, { type: "input_json_delta", partial_json: json.slice(0, cut) }),
    blockDelta(3, { type: "input_json_delta", partial_json: json.slice(cut, 2 * cut) }),
    blockDelta(3, { type: "input_json_delta", partial_json: json.slice(2 * cut) }),
    blockStop(3),
    { type: "message_delta", delta: { stop_reason: "tool_use" } },
    { type: "message_stop" },
  ];
}

test("flux SSE : message reconstitué, étapes et verdict partiel émis dans l'ordre", async () => {
  const input = {
    ...VALID,
    sources: [
      { url: "https://www.insee.fr/fr/stat", description: "Réelle" },
      { url: "https://inventee.example", description: "Inventée" },
    ],
  };
  const fetchFn = fakeFetch([sseResponse(streamEvents(input))]);
  const ctx = loadContext(fetchFn);
  const progress = [];
  const result = await get(ctx, "callAnthropic")("clé", ctxOf("On le sait : soit on ferme, soit on meurt."), {
    onProgress: (event) => progress.push(plain(event)),
  });

  assert.equal(fetchFn.calls[0].body.stream, true);
  assert.deepEqual(
    progress.map((e) => (e.type === "stage" ? `stage:${e.stage}` : `partial:${Object.keys(e.fields).join("+")}`)),
    ["stage:thinking", "stage:searching", "stage:writing", "partial:statut+resume"]
  );
  assert.equal(progress.at(-1).fields.statut, "Faux");
  assert.equal(progress.at(-1).fields.resume, "Le chiffre cité est inexact.");

  assert.equal(result.statut, "Faux");
  assert.deepEqual(plain(result.sources.map((s) => s.description)), ["Réelle"], "sources filtrées sur les résultats du flux");
  assert.equal(result.reponse_suggeree.startsWith("Selon l'INSEE"), true);
});

test("flux SSE : le verdict partiel gère les échappements et n'est émis qu'une fois", async () => {
  const input = { ...VALID, resume: 'Il a dit « non » — "oui".\nFin.' };
  const fetchFn = fakeFetch([sseResponse(streamEvents(input), 11)]);
  const progress = [];
  await get(loadContext(fetchFn), "callAnthropic")("clé", ctxOf("texte flux 2"), {
    webSearch: false,
    onProgress: (event) => progress.push(plain(event)),
  });
  const partials = progress.filter((e) => e.type === "partial");
  assert.equal(partials.length, 1);
  assert.equal(partials[0].fields.resume, 'Il a dit « non » — "oui".\nFin.');
});

test("flux SSE : erreur survenue en cours de flux", async () => {
  const events = [
    { type: "message_start", message: { id: "m", content: [] } },
    { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
  ];
  await assert.rejects(
    get(loadContext(fakeFetch([sseResponse(events)])), "callAnthropic")("clé", ctxOf("texte flux 3"), {
      webSearch: false,
      onProgress: () => {},
    }),
    /surchargée/
  );
});

test("flux SSE : refus du modèle et absence d'outil suivis de la requête de secours", async () => {
  const noTool = [
    { type: "message_start", message: { id: "m", content: [] } },
    blockStart(0, { type: "text", text: "" }),
    blockDelta(0, { type: "text_delta", text: "Je vais d'abord chercher." }),
    blockStop(0),
    { type: "message_delta", delta: { stop_reason: "pause_turn" } },
  ];
  const fetchFn = fakeFetch([sseResponse(noTool), sseResponse(streamEvents(VALID))]);
  const result = await get(loadContext(fetchFn), "callAnthropic")("clé", ctxOf("texte flux 4"), { onProgress: () => {} });
  assert.equal(fetchFn.calls.length, 2);
  assert.equal(result.statut, "Faux");

  const refusal = [
    { type: "message_start", message: { id: "m", content: [] } },
    { type: "message_delta", delta: { stop_reason: "refusal" } },
  ];
  await assert.rejects(
    get(loadContext(fakeFetch([sseResponse(refusal)])), "callAnthropic")("clé", ctxOf("texte flux 5"), { webSearch: false, onProgress: () => {} }),
    /refusé d'analyser/
  );
});

test("flux SSE : une annulation pendant la lecture lève AbortError", async () => {
  const controller = new AbortController();
  const fetchFn = async () => ({
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: () =>
          new Promise((resolve, reject) => {
            controller.signal.addEventListener("abort", () => reject(Object.assign(new Error("x"), { name: "AbortError" })));
          }),
      }),
    },
  });
  const pending = get(loadContext(fetchFn), "callAnthropic")("clé", ctxOf("texte flux 6"), {
    webSearch: false,
    onProgress: () => {},
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, (error) => error.name === "AbortError");
});

// --- Régénération de la réponse ---------------------------------------------------------

const ANALYSIS = {
  statut: "Faux",
  resume: "Le chiffre cité est inexact.",
  rhetorique: [{ type: "Faux Dilemme", extrait: "soit on ferme", explication: "Choix binaire." }],
  contexte: { probleme_detecte: true, explication: "Période omise." },
  sources: [{ url: "https://www.insee.fr/fr/stat", description: "Taux de chômage" }],
};

test("callReply : un seul appel sans recherche, ton et cible dans le prompt, URL retirées", async () => {
  const fetchFn = fakeFetch([
    jsonResponse(200, {
      content: [
        { type: "tool_use", id: "t", name: "submit_reply", input: { reponse: "Selon l'INSEE, c'est 7 %. https://inventee.example/x" } },
      ],
    }),
  ]);
  const ctx = loadContext(fetchFn);
  const reply = await get(ctx, "callReply")("clé", ctxOf("Le chômage a doublé", { pageTitle: "Post" }), ANALYSIS, {
    model: "claude-haiku-5-5",
    tone: "ferme",
    target: "publication",
    replyStyle: "detaille",
  });

  assert.equal(reply, "Selon l'INSEE, c'est 7 %.");
  assert.equal(fetchFn.calls.length, 1);
  const { body } = fetchFn.calls[0];
  assert.equal(body.model, "claude-haiku-5-5");
  assert.deepEqual(body.tools.map((t) => t.name), ["submit_reply"]);
  assert.equal(body.tool_choice, undefined);
  assert.deepEqual(plain(body.output_config), { effort: "low" });
  assert.match(body.system, /N'ÉCRIS JAMAIS d'URL/);
  assert.match(body.system, /RÈGLE ABSOLUE — NEUTRALITÉ/);
  const prompt = body.messages[0].content;
  assert.match(prompt, /la publication principale de la page/);
  assert.match(prompt, /ferme mais courtois/);
  assert.match(prompt, /détaillée \(700 caractères/);
  assert.match(prompt, /Verdict déjà établi : Faux — Le chiffre cité est inexact\./);
  assert.match(prompt, /- insee\.fr : Taux de chômage/);
  assert.ok(!prompt.includes("https://www.insee.fr"), "l'URL n'est jamais donnée au modèle pour la réponse");
});

test("callReply : ton très court forcé à la longueur courte, sans source = pas de fait précis", async () => {
  const fetchFn = fakeFetch([jsonResponse(200, { content: [{ type: "text", text: "Pouvez-vous citer votre source ?" }] })]);
  const reply = await get(loadContext(fetchFn), "callReply")(
    "clé",
    ctxOf("Texte"),
    { ...ANALYSIS, sources: [] },
    { tone: "concis", replyStyle: "detaille" }
  );
  assert.equal(reply, "Pouvez-vous citer votre source ?", "texte libre accepté à défaut d'outil");
  const prompt = fetchFn.calls[0].body.messages[0].content;
  assert.match(prompt, /courte \(280 caractères/);
  assert.match(prompt, /Aucune source vérifiée : n'affirme aucun chiffre/);
});

test("callReply : réponse vide acceptée, refus et erreurs signalés", async () => {
  const empty = fakeFetch([jsonResponse(200, { content: [{ type: "tool_use", id: "t", name: "submit_reply", input: { reponse: "" } }] })]);
  assert.equal(await get(loadContext(empty), "callReply")("clé", ctxOf("Texte"), ANALYSIS, {}), "");

  const none = fakeFetch([jsonResponse(200, { content: [] })]);
  await assert.rejects(get(loadContext(none), "callReply")("clé", ctxOf("Texte"), ANALYSIS, {}), /pas renvoyé de réponse/);

  const refusal = fakeFetch([jsonResponse(200, { stop_reason: "refusal", content: [] })]);
  await assert.rejects(get(loadContext(refusal), "callReply")("clé", ctxOf("Texte"), ANALYSIS, {}), /refusé/);

  const bad = fakeFetch([jsonResponse(401, { error: { message: "invalid x-api-key" } })]);
  await assert.rejects(get(loadContext(bad), "callReply")("clé", ctxOf("Texte"), ANALYSIS, {}), /Clé API Anthropic invalide/);
});

test("les tons et cibles de réponse sont cohérents avec l'interface", () => {
  const ctx = loadContext(async () => {});
  assert.deepEqual(plain(get(ctx, "Object.keys(REPLY_TONES)")), ["neutre", "ferme", "chaleureux", "question", "concis"]);
  assert.deepEqual(plain(get(ctx, "Object.keys(REPLY_TARGETS)")), ["message", "publication"]);
  const content = fs.readFileSync(path.join(EXT, "content.js"), "utf8");
  for (const tone of Object.keys(plain(get(ctx, "REPLY_TONES")))) {
    assert.ok(content.includes(`["${tone}",`), `ton ${tone} absent de l'interface`);
  }
  assert.ok(content.includes('value="publication"') && content.includes('value="message"'));
  assert.equal(plain(get(ctx, "REPLY_SYSTEM_PROMPT")).includes("submit_reply"), true);
});
