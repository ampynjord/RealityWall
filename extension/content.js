/**
 * Content script RealityWall : interface injectée dans la page.
 *
 * - pop-up de résultat (déplaçable, repliable, résumé d'abord) ;
 * - bouton flottant à côté d'une sélection de texte ;
 * - collecte du contexte (voir context.js) puis envoi au service worker,
 *   qui appelle l'API et renvoie le verdict.
 *
 * Sans dépendance externe ni framework : DOM natif et CSS scopé par
 * préfixe `rw-`.
 */

const api = typeof browser !== "undefined" ? browser : chrome;

const OVERLAY_ID = "reality-wall-overlay";
const BUBBLE_ID = "reality-wall-bubble";
const OVERLAY_WIDTH = 420;
const MARGIN = 12;
const MIN_SELECTION_CHARS = 15;
const SLOW_HINT_SECONDS = 20;

const STATUT_HELP = {
  Vrai: "Affirmation exacte et correctement contextualisée.",
  Faux: "Affirmation contredite par les données vérifiables.",
  Incomplet: "Affirmation vraie mais qui omet une information essentielle.",
  Raccourci: "Simplification qui déforme la conclusion.",
  "Hors-sujet": "Pas d'affirmation factuelle vérifiable (opinion, question, insulte...).",
};

let lastPointer = { x: 200, y: 120 };
let lastContextTarget = null;
let lastContext = null;
let userPosition = null;
let loadingTimer = null;

document.addEventListener(
  "contextmenu",
  (event) => {
    lastPointer = { x: event.clientX, y: event.clientY };
    lastContextTarget = event.target;
  },
  true
);

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

/** Seules les URLs http(s) deviennent des liens (jamais javascript:, data:...). */
function isSafeHttpUrl(value) {
  try {
    const url = new URL(String(value).trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch (error) {
    return false;
  }
}

function hostOf(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch (error) {
    return value;
  }
}

function getOverlay() {
  return document.getElementById(OVERLAY_ID);
}

function stopLoadingTimer() {
  if (loadingTimer) {
    clearInterval(loadingTimer);
    loadingTimer = null;
  }
}

function removeOverlay() {
  stopLoadingTimer();
  const existing = getOverlay();
  if (existing) {
    existing.remove();
  }
}

async function getSettings() {
  try {
    return await api.storage.local.get({ useMedia: true, selectionButton: true });
  } catch (error) {
    return { useMedia: true, selectionButton: true };
  }
}

// ---------------------------------------------------------------------------
// Position et déplacement
// ---------------------------------------------------------------------------

function clampToViewport(overlay, left, top) {
  const width = overlay.offsetWidth || OVERLAY_WIDTH;
  const height = overlay.offsetHeight || 0;
  const maxLeft = window.innerWidth - width - MARGIN;
  const maxTop = window.innerHeight - height - MARGIN;
  return {
    left: Math.max(MARGIN, Math.min(left, maxLeft)),
    top: Math.max(MARGIN, Math.min(top, maxTop)),
  };
}

function placeOverlay(overlay) {
  let left;
  let top;
  if (userPosition) {
    ({ left, top } = userPosition);
  } else {
    // À droite du point d'interaction, sinon à gauche, sans le recouvrir.
    const width = overlay.offsetWidth || OVERLAY_WIDTH;
    left = lastPointer.x + MARGIN * 2;
    if (left + width > window.innerWidth - MARGIN) {
      left = lastPointer.x - width - MARGIN * 2;
    }
    top = lastPointer.y - 20;
  }
  const clamped = clampToViewport(overlay, left, top);
  overlay.style.left = `${clamped.left}px`;
  overlay.style.top = `${clamped.top}px`;
}

function enableDrag(overlay) {
  const header = overlay.querySelector(".rw-header");
  header.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) {
      return;
    }
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = overlay.offsetLeft;
    const startTop = overlay.offsetTop;
    header.setPointerCapture(event.pointerId);
    header.classList.add("rw-dragging");

    const onMove = (moveEvent) => {
      const next = clampToViewport(
        overlay,
        startLeft + moveEvent.clientX - startX,
        startTop + moveEvent.clientY - startY
      );
      overlay.style.left = `${next.left}px`;
      overlay.style.top = `${next.top}px`;
      userPosition = next;
    };
    const onUp = () => {
      header.classList.remove("rw-dragging");
      header.removeEventListener("pointermove", onMove);
      header.removeEventListener("pointerup", onUp);
      header.removeEventListener("pointercancel", onUp);
    };
    header.addEventListener("pointermove", onMove);
    header.addEventListener("pointerup", onUp);
    header.addEventListener("pointercancel", onUp);
  });
}

// ---------------------------------------------------------------------------
// Squelette
// ---------------------------------------------------------------------------

function mountOverlay(bodyHtml) {
  stopLoadingTimer();
  const existing = getOverlay();
  const wasMinimized = existing ? existing.classList.contains("rw-min") : false;
  if (existing) {
    existing.remove();
  }
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "reality-wall-overlay" + (wasMinimized ? " rw-min" : "");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Analyse RealityWall");
  overlay.innerHTML = `
    <div class="rw-header">
      <span class="rw-title">RealityWall</span>
      <div class="rw-actions">
        <button type="button" class="rw-icon rw-minimize" aria-label="Réduire ou agrandir" title="Réduire / agrandir">&minus;</button>
        <button type="button" class="rw-icon rw-close" aria-label="Fermer" title="Fermer (Échap)">&times;</button>
      </div>
    </div>
    <div class="rw-body" aria-live="polite">${bodyHtml}</div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector(".rw-close").addEventListener("click", removeOverlay);
  overlay.querySelector(".rw-minimize").addEventListener("click", () => {
    overlay.classList.toggle("rw-min");
    placeOverlay(overlay);
  });
  enableDrag(overlay);
  placeOverlay(overlay);
  return overlay;
}

// ---------------------------------------------------------------------------
// États : chargement, erreur, résultat
// ---------------------------------------------------------------------------

function renderLoading(label) {
  const existing = getOverlay();
  const loadingLabel = existing && existing.querySelector(".rw-loading .rw-loading-label");
  if (loadingLabel) {
    loadingLabel.textContent = label;
    return;
  }

  const overlay = mountOverlay(`
    <div class="rw-loading">
      <div class="rw-spinner" aria-hidden="true"></div>
      <div class="rw-loading-text">
        <p class="rw-loading-label">${escapeHtml(label)}</p>
        <p class="rw-loading-time"><span class="rw-elapsed">0</span> s</p>
        <p class="rw-loading-hint" hidden>
          Long ? Désactivez la recherche web ou choisissez Claude Haiku dans
          les réglages de l'extension pour aller plus vite.
        </p>
      </div>
    </div>
    <div class="rw-footer"><button type="button" class="rw-btn rw-cancel">Annuler</button></div>
  `);

  const started = Date.now();
  const elapsed = overlay.querySelector(".rw-elapsed");
  const hint = overlay.querySelector(".rw-loading-hint");
  loadingTimer = setInterval(() => {
    const seconds = Math.round((Date.now() - started) / 1000);
    elapsed.textContent = String(seconds);
    hint.hidden = seconds < SLOW_HINT_SECONDS;
  }, 1000);

  overlay.querySelector(".rw-cancel").addEventListener("click", () => {
    api.runtime.sendMessage({ type: "REALITYWALL_CANCEL" });
    removeOverlay();
  });
}

function renderError(message) {
  const canRetry = Boolean(lastContext);
  const overlay = mountOverlay(`
    <p class="rw-error">${escapeHtml(message)}</p>
    <div class="rw-footer">
      ${canRetry ? '<button type="button" class="rw-btn rw-retry">Réessayer</button>' : ""}
      <button type="button" class="rw-btn rw-secondary rw-options">Ouvrir les réglages</button>
    </div>
  `);
  const retry = overlay.querySelector(".rw-retry");
  if (retry) {
    retry.addEventListener("click", () => reanalyze(true));
  }
  overlay.querySelector(".rw-options").addEventListener("click", () => {
    api.runtime.sendMessage({ type: "REALITYWALL_OPEN_OPTIONS" });
  });
}

function statutBadgeClass(statut) {
  switch (statut) {
    case "Vrai":
      return "rw-badge-green";
    case "Faux":
      return "rw-badge-red";
    case "Incomplet":
    case "Raccourci":
      return "rw-badge-yellow";
    default:
      return "rw-badge-neutral";
  }
}

function sectionHtml(title, countLabel, bodyHtml, open) {
  return `
    <details class="rw-section"${open ? " open" : ""}>
      <summary><span class="rw-label">${escapeHtml(title)}</span>${countLabel ? `<span class="rw-count">${escapeHtml(countLabel)}</span>` : ""}</summary>
      <div class="rw-section-body">${bodyHtml}</div>
    </details>
  `;
}

function rhetoriqueHtml(rhetorique) {
  const items = (Array.isArray(rhetorique) ? rhetorique : [])
    .map(
      (item) => `
      <li class="rw-rhet-item">
        <span class="rw-badge rw-badge-red">${escapeHtml(item.type)}</span>
        ${item.extrait ? `<blockquote class="rw-quote">&laquo; ${escapeHtml(item.extrait)} &raquo;</blockquote>` : ""}
        <p>${escapeHtml(item.explication)}</p>
      </li>`
    )
    .join("");
  return items
    ? `<ul class="rw-list">${items}</ul>`
    : '<p class="rw-empty">Aucun procédé rhétorique clairement détecté.</p>';
}

function sourcesHtml(sources) {
  const items = (Array.isArray(sources) ? sources : [])
    .map(
      (source) => `
      <li class="rw-source-item">
        ${
          isSafeHttpUrl(source.url)
            ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(hostOf(source.url))}</a>`
            : `<span>${escapeHtml(source.url)}</span>`
        }
        <p>${escapeHtml(source.description)}</p>
      </li>`
    )
    .join("");
  return items
    ? `<ul class="rw-list">${items}</ul>`
    : '<p class="rw-empty">Aucune source vérifiée (recherche web désactivée ou sans résultat).</p>';
}

function replyHtml(reply, sources) {
  if (!reply) {
    return '<p class="rw-empty">Rien de factuel à répondre à ce contenu.</p>';
  }
  const first = (sources || []).find((source) => isSafeHttpUrl(source.url));
  return `
    <textarea class="rw-reply-text" rows="5" spellcheck="true" aria-label="Réponse suggérée"></textarea>
    ${
      first
        ? `<label class="rw-check"><input type="checkbox" class="rw-include-source" checked /> Ajouter la source (${escapeHtml(hostOf(first.url))})</label>`
        : ""
    }
    <div class="rw-reply-actions">
      <button type="button" class="rw-btn rw-copy">Copier la réponse</button>
      <span class="rw-count rw-reply-length"></span>
    </div>
  `;
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  }
  return Promise.resolve(legacyCopy(text));
}

function legacyCopy(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.style.cssText = "position:fixed;top:-1000px;opacity:0";
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand("copy");
  } finally {
    area.remove();
  }
}

function bindReply(overlay, data) {
  const textarea = overlay.querySelector(".rw-reply-text");
  if (!textarea) {
    return;
  }
  textarea.value = data.reponse_suggeree;
  const includeSource = overlay.querySelector(".rw-include-source");
  const length = overlay.querySelector(".rw-reply-length");
  const first = (data.sources || []).find((source) => isSafeHttpUrl(source.url));

  const finalText = () =>
    includeSource && includeSource.checked && first
      ? `${textarea.value.trim()}\n\nSource : ${first.url}`
      : textarea.value.trim();
  const updateLength = () => {
    length.textContent = `${finalText().length} car.`;
  };
  textarea.addEventListener("input", updateLength);
  if (includeSource) {
    includeSource.addEventListener("change", updateLength);
  }
  updateLength();

  const copy = overlay.querySelector(".rw-copy");
  copy.addEventListener("click", async () => {
    await copyToClipboard(finalText());
    copy.textContent = "Copié ✓";
    setTimeout(() => {
      copy.textContent = "Copier la réponse";
    }, 1800);
  });
}

function renderResult(data) {
  const meta = data.meta || { used: [], notes: [] };
  const rhetorique = Array.isArray(data.rhetorique) ? data.rhetorique : [];
  const sources = Array.isArray(data.sources) ? data.sources : [];
  const contexteProbleme = Boolean(data.contexte && data.contexte.probleme_detecte);

  const overlay = mountOverlay(`
    <div class="rw-verdict">
      <span class="rw-badge rw-badge-big ${statutBadgeClass(data.statut)}" title="${escapeHtml(STATUT_HELP[data.statut] || "")}">${escapeHtml(data.statut)}</span>
      <p class="rw-summary">${escapeHtml(data.resume || STATUT_HELP[data.statut] || "")}</p>
    </div>
    ${meta.used.length ? `<p class="rw-used">Analysé : ${escapeHtml(meta.used.join(" · "))}</p>` : ""}
    ${meta.notes.map((note) => `<p class="rw-note">${escapeHtml(note)}</p>`).join("")}
    ${sectionHtml("Réponse suggérée", "", replyHtml(data.reponse_suggeree, sources), Boolean(data.reponse_suggeree))}
    ${sectionHtml("Rhétorique", rhetorique.length ? String(rhetorique.length) : "aucune", rhetoriqueHtml(rhetorique), rhetorique.length > 0)}
    ${sectionHtml(
      "Contexte",
      contexteProbleme ? "incomplet" : "ok",
      contexteProbleme
        ? `<div class="rw-context"><p>${escapeHtml(data.contexte.explication)}</p></div>`
        : '<p class="rw-empty">Aucun élément de contexte manquant détecté.</p>',
      contexteProbleme
    )}
    ${sectionHtml("Sources", sources.length ? String(sources.length) : "aucune", sourcesHtml(sources), sources.length > 0)}
    <div class="rw-footer">
      <button type="button" class="rw-btn rw-secondary rw-reanalyze">Réanalyser</button>
    </div>
    <p class="rw-disclaimer">
      Analyse automatique par IA, susceptible d'erreurs : vérifiez les
      sources avant de vous y fier.
    </p>
  `);

  bindReply(overlay, data);
  overlay.querySelector(".rw-reanalyze").addEventListener("click", () => reanalyze(true));
  overlay.querySelectorAll("details").forEach((details) =>
    details.addEventListener("toggle", () => placeOverlay(overlay))
  );
  placeOverlay(overlay);
}

// ---------------------------------------------------------------------------
// Lancement d'une analyse
// ---------------------------------------------------------------------------

function mediaAt(x, y) {
  const found = document
    .elementsFromPoint(x, y)
    .find((element) => element.tagName === "VIDEO" || element.tagName === "IMG");
  return found || null;
}

function hasSelection() {
  const selection = window.getSelection ? window.getSelection() : null;
  return Boolean(selection && selection.toString().trim());
}

async function startAnalysis(mode, extra = {}) {
  hideBubble();
  renderLoading("Lecture du contexte…");

  const settings = await getSettings();
  const effectiveMode = mode === "auto" ? (hasSelection() ? "selection" : "page") : mode;
  const options = { useMedia: settings.useMedia, srcUrl: extra.srcUrl };
  if (effectiveMode === "media") {
    options.target = mediaAt(lastPointer.x, lastPointer.y) || lastContextTarget;
  }

  let context;
  try {
    context = await rwCollectContext(effectiveMode, options);
  } catch (error) {
    renderError("Impossible de lire le contenu de la page.");
    return;
  }
  if (!context.text.trim() && context.images.length === 0 && !context.frame) {
    renderError("Aucun contenu à analyser ici : sélectionnez un texte ou ouvrez une page avec du contenu.");
    return;
  }

  lastContext = context;
  renderLoading("Recherche de sources et analyse…");
  api.runtime.sendMessage({ type: "REALITYWALL_ANALYZE", context, fresh: false });
}

function reanalyze(fresh) {
  if (!lastContext) {
    return;
  }
  renderLoading("Nouvelle analyse…");
  api.runtime.sendMessage({ type: "REALITYWALL_ANALYZE", context: lastContext, fresh });
}

// ---------------------------------------------------------------------------
// Bouton flottant près d'une sélection
// ---------------------------------------------------------------------------

let bubbleTimer = null;

function hideBubble() {
  const bubble = document.getElementById(BUBBLE_ID);
  if (bubble) {
    bubble.remove();
  }
}

function insideOwnUi(node) {
  const element = node && (node.nodeType === 1 ? node : node.parentElement);
  return Boolean(element && element.closest && element.closest(`#${OVERLAY_ID}, #${BUBBLE_ID}`));
}

async function updateBubble() {
  const selection = window.getSelection ? window.getSelection() : null;
  const text = selection ? selection.toString().trim() : "";
  if (!selection || selection.rangeCount === 0 || text.length < MIN_SELECTION_CHARS || insideOwnUi(selection.anchorNode)) {
    hideBubble();
    return;
  }
  const settings = await getSettings();
  if (!settings.selectionButton) {
    hideBubble();
    return;
  }

  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0) || rect.bottom < 0 || rect.top > window.innerHeight) {
    hideBubble();
    return;
  }

  let bubble = document.getElementById(BUBBLE_ID);
  if (!bubble) {
    bubble = document.createElement("button");
    bubble.id = BUBBLE_ID;
    bubble.type = "button";
    bubble.className = "reality-wall-bubble";
    bubble.textContent = "Analyser avec RealityWall";
    bubble.setAttribute("aria-label", "Analyser la sélection avec RealityWall");
    // Garde la sélection active quand on clique sur le bouton.
    bubble.addEventListener("mousedown", (event) => event.preventDefault());
    bubble.addEventListener("click", () => {
      lastPointer = { x: bubble.offsetLeft, y: bubble.offsetTop };
      startAnalysis("selection");
    });
    document.body.appendChild(bubble);
  }
  const left = Math.max(MARGIN, Math.min(rect.right, window.innerWidth - bubble.offsetWidth - MARGIN));
  const below = rect.bottom + 8;
  const preferred = below + bubble.offsetHeight > window.innerHeight ? rect.top - bubble.offsetHeight - 8 : below;
  const top = Math.max(MARGIN, Math.min(preferred, window.innerHeight - bubble.offsetHeight - MARGIN));
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
}

function scheduleBubbleUpdate() {
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(updateBubble, 180);
}

document.addEventListener("mouseup", scheduleBubbleUpdate);
document.addEventListener("keyup", (event) => {
  if (event.key === "Shift" || event.key.startsWith("Arrow")) {
    scheduleBubbleUpdate();
  }
});
document.addEventListener("touchend", scheduleBubbleUpdate);
document.addEventListener("selectionchange", () => {
  const selection = window.getSelection();
  if (!selection || !selection.toString().trim()) {
    hideBubble();
  }
});
window.addEventListener("scroll", hideBubble, { passive: true, capture: true });

// ---------------------------------------------------------------------------
// Messages du service worker
// ---------------------------------------------------------------------------

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return;
  }

  switch (message.type) {
    case "REALITYWALL_PING":
      sendResponse({ ok: true });
      break;
    case "REALITYWALL_START":
      startAnalysis(message.mode || "auto", { srcUrl: message.srcUrl });
      break;
    case "REALITYWALL_LOADING":
      renderLoading(message.label || "Analyse en cours…");
      break;
    case "REALITYWALL_RESULT":
      renderResult(message.payload);
      break;
    case "REALITYWALL_ERROR":
      renderError(message.message);
      break;
    default:
      break;
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    removeOverlay();
    hideBubble();
  }
});
