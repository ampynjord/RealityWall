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
  const ctx = vm.createContext({ URL, console, setTimeout, Promise, JSON });
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
  rhetorique: [{ type: "Faux Dilemme", explication: "Choix binaire artificiel." }],
  contexte: { probleme_detecte: true, explication: "Période omise." },
  sources: [],
};

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** Double de fetch qui rejoue des réponses dans l'ordre et enregistre les requêtes. */
function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
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

test("validateRealityCheckResult accepte une sortie conforme", () => {
  const ctx = loadContext(async () => {});
  const fn = get(ctx, "validateRealityCheckResult");
  assert.equal(fn(structuredClone(VALID)).statut, "Faux");
});

test("validateRealityCheckResult rejette les sorties non conformes", () => {
  const ctx = loadContext(async () => {});
  const fn = get(ctx, "validateRealityCheckResult");
  const bad = [
    null,
    { ...VALID, statut: "Peut-être" },
    { ...VALID, rhetorique: "non" },
    { ...VALID, rhetorique: [{ type: "Inconnu", explication: "x" }] },
    { ...VALID, contexte: { probleme_detecte: "oui", explication: "" } },
    { ...VALID, sources: "non" },
    { ...VALID, sources: [{ url: "https://a.fr", description: "" }] },
  ];
  for (const data of bad) {
    assert.throws(() => fn(structuredClone(data)), /non conforme/);
  }
});

test("stripDanglingServerToolUse retire les appels serveur sans résultat", () => {
  const ctx = loadContext(async () => {});
  const strip = get(ctx, "stripDanglingServerToolUse");
  const paired = [serverUse("a"), searchResult([], "a"), { type: "text", text: "ok" }];
  assert.deepEqual(plain(strip(paired)), paired);

  const truncated = [serverUse("a"), searchResult([], "a"), serverUse("b")];
  assert.deepEqual(
    plain(strip(truncated).map((b) => b.type + ":" + (b.id || b.tool_use_id))),
    ["server_tool_use:a", "web_search_tool_result:a"]
  );

  // Type de résultat inconnu mais suivant la convention *_tool_result.
  const future = [serverUse("c"), { type: "future_tool_result", tool_use_id: "c" }];
  assert.equal(strip(future).length, 2);
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

test("recherche web : un seul appel, deux outils, sources filtrées", async () => {
  const fetchFn = fakeFetch([
    jsonResponse(200, {
      content: [
        serverUse("srv_1"),
        searchResult(["https://www.insee.fr/fr/stat"]),
        submit({
          ...VALID,
          sources: [
            { url: "https://www.insee.fr/fr/stat", description: "Réelle" },
            { url: "https://inventee.example", description: "Inventée" },
          ],
        }),
      ],
    }),
  ]);
  const ctx = loadContext(fetchFn);
  const result = await get(ctx, "callAnthropic")("clé", "texte A", "https://page.example", {});

  assert.equal(fetchFn.calls.length, 1);
  const { init, body } = fetchFn.calls[0];
  assert.equal(init.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(init.headers["x-api-key"], "clé");
  assert.equal(body.model, "claude-sonnet-5");
  assert.deepEqual(body.tools.map((t) => t.name), ["web_search", "submit_reality_check"]);
  assert.equal(body.tools[0].type, "web_search_20260209");
  assert.equal(body.tool_choice, undefined);
  assert.deepEqual(plain(result.sources.map((s) => s.description)), ["Réelle"]);
});

test("recherche web : appel de secours forcé si le modèle ne finalise pas", async () => {
  const fetchFn = fakeFetch([
    jsonResponse(200, {
      content: [serverUse("srv_1"), searchResult(["https://www.insee.fr/a"], "srv_1"), serverUse("srv_dangling")],
    }),
    jsonResponse(200, {
      content: [submit({ ...VALID, sources: [{ url: "https://www.insee.fr/a", description: "Réelle" }] })],
    }),
  ]);
  const ctx = loadContext(fetchFn);
  const result = await get(ctx, "callAnthropic")("clé", "texte B", null, {});

  assert.equal(fetchFn.calls.length, 2);
  const second = fetchFn.calls[1].body;
  assert.deepEqual(second.tool_choice, { type: "tool", name: "submit_reality_check" });
  assert.deepEqual(second.tools.map((t) => t.name), ["submit_reality_check"]);
  const assistant = second.messages[1];
  assert.equal(assistant.role, "assistant");
  assert.ok(!assistant.content.some((b) => b.id === "srv_dangling"), "server_tool_use orphelin retiré");
  assert.equal(result.sources.length, 1);
});

test("sans recherche web : un appel forcé, aucune source", async () => {
  const fetchFn = fakeFetch([
    jsonResponse(200, {
      content: [submit({ ...VALID, sources: [{ url: "https://inventee.example", description: "x" }] })],
    }),
  ]);
  const ctx = loadContext(fetchFn);
  const result = await get(ctx, "callAnthropic")("clé", "texte C", null, { webSearch: false });

  assert.equal(fetchFn.calls.length, 1);
  const { body } = fetchFn.calls[0];
  assert.deepEqual(body.tools.map((t) => t.name), ["submit_reality_check"]);
  assert.deepEqual(body.tool_choice, { type: "tool", name: "submit_reality_check" });
  assert.deepEqual(plain(result.sources), []);
});

test("Haiku utilise l'outil de recherche basique", async () => {
  const fetchFn = fakeFetch([jsonResponse(200, { content: [submit(VALID)] })]);
  const ctx = loadContext(fetchFn);
  await get(ctx, "callAnthropic")("clé", "texte D", null, { model: "claude-haiku-4-5" });
  assert.equal(fetchFn.calls[0].body.model, "claude-haiku-4-5");
  assert.equal(fetchFn.calls[0].body.tools[0].type, "web_search_20250305");
});

test("le cache évite un second appel réseau identique", async () => {
  const fetchFn = fakeFetch([jsonResponse(200, { content: [submit(VALID)] })]);
  const ctx = loadContext(fetchFn);
  const call = get(ctx, "callAnthropic");
  const first = await call("clé", "texte E", null, { webSearch: false });
  const second = await call("clé", "texte E", null, { webSearch: false });
  assert.equal(fetchFn.calls.length, 1);
  assert.equal(second, first);
});

test("erreurs API : messages explicites", async () => {
  const cors = fakeFetch([
    jsonResponse(401, { error: { message: "CORS requests must set 'anthropic-dangerous-direct-browser-access' header" } }),
  ]);
  await assert.rejects(
    get(loadContext(cors), "callAnthropic")("clé", "t1", null, { webSearch: false }),
    /en-tête manquant/
  );

  const badKey = fakeFetch([jsonResponse(401, { error: { message: "invalid x-api-key" } })]);
  await assert.rejects(
    get(loadContext(badKey), "callAnthropic")("clé", "t2", null, { webSearch: false }),
    /Clé API Anthropic invalide/
  );

  const noTool = fakeFetch([jsonResponse(200, { content: [{ type: "text", text: "bonjour" }] })]);
  await assert.rejects(
    get(loadContext(noTool), "callAnthropic")("clé", "t3", null, { webSearch: false }),
    /analyse structurée/
  );
});

test("une erreur transitoire (529) est retentée une fois", async () => {
  const fetchFn = fakeFetch([
    jsonResponse(529, { error: { message: "overloaded" } }),
    jsonResponse(200, { content: [submit(VALID)] }),
  ]);
  const result = await get(loadContext(fetchFn), "callAnthropic")("clé", "t4", null, { webSearch: false });
  assert.equal(fetchFn.calls.length, 2);
  assert.equal(result.statut, "Faux");

  const always = fakeFetch([jsonResponse(529, {}), jsonResponse(529, {})]);
  await assert.rejects(
    get(loadContext(always), "callAnthropic")("clé", "t5", null, { webSearch: false }),
    /surchargée/
  );
});

test("buildUserPrompt tient compte de la recherche web", () => {
  const ctx = loadContext(async () => {});
  const build = get(ctx, "buildUserPrompt");
  assert.match(build("abc", "https://p.fr", true), /Utilise web_search/);
  assert.match(build("abc", null, false), /recherche web est désactivée/);
});

test("le manifest charge les scripts de fond dans le bon ordre et ils existent", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.background.scripts, ["prompts.js", "core.js", "background.js"]);
  const bg = fs.readFileSync(path.join(EXT, "background.js"), "utf8");
  assert.match(bg, /importScripts\("prompts\.js", "core\.js"\)/);
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
