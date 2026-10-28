/**
 * Collecte du contexte d'une analyse dans la page : texte, images, capture
 * de la vidéo, sous-titres. Chargé avant content.js (même monde isolé :
 * aucun nom de premier niveau ne doit entrer en collision avec lui).
 *
 * Les fonctions "pures" (sans accès au DOM) sont testées sous Node, voir
 * test/context.test.js ; le reste est vérifié dans un vrai navigateur.
 */

const RW_MIN_IMAGE_SIDE = 200;
const RW_MAX_IMAGES = 3;
const RW_FRAME_MAX_SIDE = 768;
const RW_MEDIA_ROOT_LEVELS = 12;

// ---------------------------------------------------------------------------
// Fonctions pures
// ---------------------------------------------------------------------------

/** Texte de sous-titres : cues successifs, sans doublon consécutif. */
function rwCuesToText(cues) {
  const lines = [];
  for (const cue of cues || []) {
    const text = String((cue && cue.text) || "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text && lines[lines.length - 1] !== text) {
      lines.push(text);
    }
  }
  return lines.join(" ");
}

/** Texte d'une réponse de sous-titres YouTube au format json3. */
function rwParseJson3Captions(json) {
  const events = json && Array.isArray(json.events) ? json.events : [];
  const cues = events
    .filter((event) => Array.isArray(event.segs))
    .map((event) => ({ text: event.segs.map((seg) => seg.utf8 || "").join("") }));
  return rwCuesToText(cues);
}

/** Identifiant de vidéo YouTube d'une URL de page, ou "". */
function rwVideoIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") {
      return parsed.pathname.split("/")[1] || "";
    }
    if (host === "youtube.com") {
      if (parsed.pathname === "/watch") {
        return parsed.searchParams.get("v") || "";
      }
      const match = /^\/(?:shorts|embed|live)\/([\w-]{6,})/.exec(parsed.pathname);
      return match ? match[1] : "";
    }
  } catch (error) {
    // URL invalide : pas de vidéo YouTube.
  }
  return "";
}

/** Tableau JSON qui commence juste après `key` dans un texte (crochets équilibrés). */
function rwExtractJsonArray(text, key) {
  const start = text.indexOf(key);
  if (start === -1) {
    return null;
  }
  const open = text.indexOf("[", start + key.length);
  if (open === -1) {
    return null;
  }
  let depth = 0;
  let inString = false;
  for (let i = open; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (char === "\\") {
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
    } else if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(open, i + 1));
        } catch (error) {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * URL des sous-titres YouTube d'une vidéo, lue dans le script de la page.
 * Refuse si le script décrit une autre vidéo (navigation interne YouTube)
 * ou si l'URL ne pointe pas vers youtube.com.
 */
function rwExtractCaptionTrackUrl(scriptText, videoId, preferredLang) {
  if (!videoId || !String(scriptText).includes(`"videoId":"${videoId}"`)) {
    return "";
  }
  const tracks = rwExtractJsonArray(String(scriptText), '"captionTracks"');
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return "";
  }
  const lang = String(preferredLang || "fr").toLowerCase().split("-")[0];
  const track =
    tracks.find((t) => String(t.languageCode || "").toLowerCase().split("-")[0] === lang && t.kind !== "asr") ||
    tracks.find((t) => String(t.languageCode || "").toLowerCase().split("-")[0] === lang) ||
    tracks[0];
  const baseUrl = track && typeof track.baseUrl === "string" ? track.baseUrl : "";
  try {
    const parsed = new URL(baseUrl);
    return parsed.protocol === "https:" && /(^|\.)youtube\.com$/.test(parsed.hostname) ? parsed.href : "";
  } catch (error) {
    return "";
  }
}

/** Images assez grandes pour être du contenu (pas des avatars/icônes), les plus grandes d'abord. */
function rwPickImages(candidates, max = RW_MAX_IMAGES) {
  const seen = new Set();
  return (candidates || [])
    .filter((item) => item && /^https?:\/\//i.test(item.url || ""))
    .filter((item) => Math.min(item.width || 0, item.height || 0) >= RW_MIN_IMAGE_SIDE)
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .filter((item) => {
      if (seen.has(item.url)) {
        return false;
      }
      seen.add(item.url);
      return true;
    })
    .slice(0, max)
    .map((item) => item.url);
}

/** Zone de texte principale : la plus fournie parmi les candidats, sinon le corps de page. */
function rwPickMainText(candidateTexts, fallback) {
  const best = (candidateTexts || [])
    .map((text) => String(text || "").trim())
    .sort((a, b) => b.length - a.length)[0];
  return best && best.length >= 80 ? best : String(fallback || "").trim();
}

// ---------------------------------------------------------------------------
// Collecte dans le DOM
// ---------------------------------------------------------------------------

function rwSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rwIsVisible(element) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 &&
    rect.top < window.innerHeight && rect.left < window.innerWidth;
}

function rwMeta(selector) {
  const element = document.querySelector(selector);
  return element ? String(element.getAttribute("content") || "").trim() : "";
}

function rwImageInfo(img) {
  return {
    url: img.currentSrc || img.src || "",
    width: img.naturalWidth || img.width || 0,
    height: img.naturalHeight || img.height || 0,
  };
}

/** Plus proche ancêtre de la sélection qui contient une vidéo ou une grande image. */
function rwFindMediaRoot(node) {
  let element = node && (node.nodeType === 1 ? node : node.parentElement);
  for (let level = 0; element && level < RW_MEDIA_ROOT_LEVELS; level += 1, element = element.parentElement) {
    if (element.querySelector("video")) {
      return element;
    }
    const hasLargeImage = [...element.querySelectorAll("img")].some((img) => {
      const info = rwImageInfo(img);
      return Math.min(info.width, info.height) >= RW_MIN_IMAGE_SIDE;
    });
    if (hasLargeImage) {
      return element;
    }
  }
  return null;
}

/** La vidéo à analyser dans une zone : la plus grande visible, en priorité celle qui joue. */
function rwPickVideo(root) {
  const videos = [...root.querySelectorAll("video")].filter(rwIsVisible);
  videos.sort((a, b) => {
    const playing = Number(!b.paused) - Number(!a.paused);
    if (playing !== 0) {
      return playing;
    }
    const areaA = a.getBoundingClientRect().width * a.getBoundingClientRect().height;
    const areaB = b.getBoundingClientRect().width * b.getBoundingClientRect().height;
    return areaB - areaA;
  });
  return videos[0] || null;
}

/** Image JPEG (base64) de l'image affichée par la vidéo, ou null si la lecture est protégée. */
function rwCaptureFrame(video) {
  try {
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      return null;
    }
    const scale = Math.min(1, RW_FRAME_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch (error) {
    return null;
  }
}

/** Sous-titres des pistes <track> / textTracks de la vidéo, ou "". */
async function rwReadTextTrackCaptions(video) {
  const tracks = [...(video.textTracks || [])].filter((t) => t.kind === "subtitles" || t.kind === "captions");
  if (tracks.length === 0) {
    return "";
  }
  const toRestore = [];
  for (const track of tracks) {
    if (track.mode === "disabled") {
      track.mode = "hidden";
      toRestore.push(track);
    }
  }
  if (tracks.some((track) => !track.cues || track.cues.length === 0)) {
    await rwSleep(400);
  }
  const language = String(navigator.language || "fr").toLowerCase().split("-")[0];
  const usable = tracks.filter((track) => track.cues && track.cues.length > 0);
  const chosen =
    usable.find((track) => track.mode === "showing") ||
    usable.find((track) => String(track.language || "").toLowerCase().startsWith(language)) ||
    usable[0];
  const text = chosen ? rwCuesToText([...chosen.cues]) : "";
  for (const track of toRestore) {
    track.mode = "disabled";
  }
  return text;
}

/** Sous-titres YouTube (la page ne les expose pas en textTracks), ou "". */
async function rwFetchYouTubeCaptions() {
  const videoId = rwVideoIdFromUrl(location.href);
  if (!videoId) {
    return "";
  }
  for (const script of document.querySelectorAll("script:not([src])")) {
    const text = script.textContent || "";
    if (!text.includes('"captionTracks"')) {
      continue;
    }
    const url = rwExtractCaptionTrackUrl(text, videoId, navigator.language);
    if (!url) {
      continue;
    }
    const response = await fetch(`${url}&fmt=json3`, { credentials: "same-origin" });
    if (!response.ok) {
      return "";
    }
    return rwParseJson3Captions(await response.json());
  }
  return "";
}

/**
 * Contexte complet d'une analyse.
 * mode : "selection" | "page" | "media" ; options : { useMedia, target, srcUrl }.
 */
async function rwCollectContext(mode, options = {}) {
  const selection = window.getSelection ? window.getSelection() : null;
  const selectedText = selection ? selection.toString().trim() : "";
  const effectiveMode = mode === "selection" && !selectedText ? "page" : mode;

  const notes = [];
  let text = "";
  let root = document.body;

  if (effectiveMode === "selection") {
    text = selectedText;
    root = rwFindMediaRoot(selection.anchorNode);
  } else if (effectiveMode === "media" && options.target) {
    root = rwFindMediaRoot(options.target) || options.target.parentElement;
    text = (root && root.innerText) || "";
  } else {
    const main = [...document.querySelectorAll("article, main, [role='main']")].map((el) => el.innerText);
    text = rwPickMainText(main, document.body ? document.body.innerText : "");
  }

  const context = {
    mode: effectiveMode,
    text,
    pageTitle: document.title || "",
    pageUrl: location.href,
    description: rwMeta('meta[property="og:description"]') || rwMeta('meta[name="description"]'),
    captions: "",
    images: [],
    frame: null,
    notes,
  };

  if (options.useMedia === false || !root) {
    return context;
  }

  const candidates = [...root.querySelectorAll("img")].map(rwImageInfo);
  if (options.srcUrl && /^https?:\/\//i.test(options.srcUrl)) {
    candidates.push({ url: options.srcUrl, width: 10000, height: 10000 });
  }
  if (effectiveMode === "page") {
    const ogImage = rwMeta('meta[property="og:image"]');
    if (/^https?:\/\//i.test(ogImage)) {
      candidates.push({ url: ogImage, width: RW_MIN_IMAGE_SIDE, height: RW_MIN_IMAGE_SIDE });
    }
  }
  context.images = rwPickImages(candidates);

  const video =
    options.target && options.target.tagName === "VIDEO" ? options.target : rwPickVideo(root);
  if (video) {
    context.frame = rwCaptureFrame(video);
    if (!context.frame) {
      notes.push("La capture de la vidéo n'a pas été possible (lecture protégée ou non démarrée).");
    }
    try {
      context.captions = (await rwReadTextTrackCaptions(video)) || (await rwFetchYouTubeCaptions());
    } catch (error) {
      context.captions = "";
    }
    if (!context.captions) {
      notes.push("Pas de sous-titres accessibles : le son de la vidéo n'a pas été analysé.");
    }
  } else if (root.querySelector("audio")) {
    notes.push("Contenu audio sans transcription : le son n'a pas été analysé.");
  }
  return context;
}
