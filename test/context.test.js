// Tests des fonctions pures de collecte de contexte (sans DOM).
// La collecte elle-même (DOM, vidéo, sélection) est vérifiée dans un vrai
// navigateur : voir README, section « Développement et tests ».
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ctx = vm.createContext({ URL, console, setTimeout, Promise, JSON });
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "extension", "context.js"), "utf8"), ctx, {
  filename: "context.js",
});
const get = (expr) => vm.runInContext(expr, ctx);
const plain = (value) => JSON.parse(JSON.stringify(value));

test("rwCuesToText nettoie les balises et supprime les doublons consécutifs", () => {
  const text = get("rwCuesToText")([
    { text: "<c.colorE5E5E5>Bonjour</c>" },
    { text: "Bonjour" },
    { text: "  à   tous \n " },
    { text: "" },
    { text: "Bonjour" },
  ]);
  assert.equal(text, "Bonjour à tous Bonjour");
  assert.equal(get("rwCuesToText")(null), "");
});

test("rwParseJson3Captions lit le format de sous-titres YouTube", () => {
  const json = {
    events: [
      { tStartMs: 0 },
      { segs: [{ utf8: "Le chômage" }, { utf8: " a doublé" }] },
      { segs: [{ utf8: "\n" }] },
      { segs: [{ utf8: "en dix ans" }] },
    ],
  };
  assert.equal(get("rwParseJson3Captions")(json), "Le chômage a doublé en dix ans");
  assert.equal(get("rwParseJson3Captions")({}), "");
});

test("rwVideoIdFromUrl reconnaît les URLs YouTube", () => {
  const id = get("rwVideoIdFromUrl");
  assert.equal(id("https://www.youtube.com/watch?v=abc123DEF45&t=3"), "abc123DEF45");
  assert.equal(id("https://m.youtube.com/watch?v=abc123DEF45"), "abc123DEF45");
  assert.equal(id("https://youtu.be/abc123DEF45?si=x"), "abc123DEF45");
  assert.equal(id("https://www.youtube.com/shorts/abc123DEF45"), "abc123DEF45");
  assert.equal(id("https://www.instagram.com/reel/abc/"), "");
  assert.equal(id("pas une url"), "");
});

const SCRIPT = `var ytInitialPlayerResponse = {"videoDetails":{"videoId":"abc123DEF45","title":"T [x]"},
"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[
{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc123DEF45&lang=en","languageCode":"en","kind":"asr"},
{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc123DEF45&lang=fr","languageCode":"fr"}],"audioTracks":[]}}};`;

test("rwExtractCaptionTrackUrl choisit la piste de la langue, sans suivre une autre vidéo", () => {
  const extract = get("rwExtractCaptionTrackUrl");
  assert.match(extract(SCRIPT, "abc123DEF45", "fr-FR"), /lang=fr$/);
  assert.match(extract(SCRIPT, "abc123DEF45", "en-US"), /lang=en$/);
  assert.match(extract(SCRIPT, "abc123DEF45", "de"), /lang=en$/, "repli sur la première piste");
  assert.equal(extract(SCRIPT, "autreVideo99", "fr"), "", "script d'une autre vidéo");
  assert.equal(extract("rien ici", "abc123DEF45", "fr"), "");
});

test("rwExtractCaptionTrackUrl refuse une URL hors de youtube.com", () => {
  const evil = SCRIPT.replace(/https:\/\/www\.youtube\.com\/api\/timedtext\?v=abc123DEF45&lang=fr/, "https://evil.example/steal");
  assert.equal(get("rwExtractCaptionTrackUrl")(evil, "abc123DEF45", "fr"), "");
});

test("rwExtractJsonArray gère les crochets et guillemets imbriqués", () => {
  const out = get("rwExtractJsonArray")('{"k":[{"a":"]\\"[","b":[1,2]},3]} suite', '"k"');
  assert.deepEqual(plain(out), [{ a: ']"[', b: [1, 2] }, 3]);
  assert.equal(get("rwExtractJsonArray")('{"k":[1,2', '"k"'), null);
});

test("rwPickImages garde les grandes images http(s), les plus grandes d'abord", () => {
  const pick = get("rwPickImages");
  const out = pick([
    { url: "https://a.example/avatar.jpg", width: 48, height: 48 },
    { url: "https://a.example/medium.jpg", width: 400, height: 300 },
    { url: "https://a.example/big.jpg", width: 1080, height: 1350 },
    { url: "https://a.example/big.jpg", width: 1080, height: 1350 },
    { url: "data:image/png;base64,AAAA", width: 900, height: 900 },
    { url: "blob:https://a.example/x", width: 900, height: 900 },
    { url: "https://a.example/banner.jpg", width: 1200, height: 150 },
    { url: "https://a.example/third.jpg", width: 300, height: 300 },
    { url: "https://a.example/fourth.jpg", width: 250, height: 250 },
  ]);
  assert.deepEqual(plain(out), [
    "https://a.example/big.jpg",
    "https://a.example/medium.jpg",
    "https://a.example/third.jpg",
  ]);
});

test("rwPickMainText préfère la zone la plus fournie, sinon le corps de page", () => {
  const pick = get("rwPickMainText");
  const long = "x".repeat(120);
  assert.equal(pick(["court", long, ""], "corps"), long);
  assert.equal(pick(["court"], "  corps de page "), "corps de page");
  assert.equal(pick([], ""), "");
});
