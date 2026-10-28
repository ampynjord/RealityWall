/**
 * Content script RealityWall.
 *
 * Affiche l'overlay de résultat au niveau du curseur, sans dépendance
 * externe ni framework : DOM natif et CSS scoping par préfixe `rw-`.
 */

const api = typeof browser !== "undefined" ? browser : chrome;

const OVERLAY_ID = "reality-wall-overlay";
const OVERLAY_WIDTH = 380;
const MARGIN = 12;

let lastClickPosition = { x: 200, y: 200 };

document.addEventListener(
  "contextmenu",
  (event) => {
    lastClickPosition = { x: event.pageX, y: event.pageY };
  },
  true
);

function removeOverlay() {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    existing.remove();
  }
}

function positionOverlay(overlay) {
  const viewportLeft = window.scrollX;
  const viewportTop = window.scrollY;
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;

  const rect = overlay.getBoundingClientRect();
  const width = rect.width || OVERLAY_WIDTH;
  const height = rect.height || 0;

  let left = lastClickPosition.x + MARGIN;
  const maxLeft = viewportLeft + viewportWidth - width - MARGIN;
  if (left > maxLeft) {
    left = Math.max(viewportLeft + MARGIN, maxLeft);
  }

  let top = lastClickPosition.y + MARGIN;
  const maxTop = viewportTop + viewportHeight - height - MARGIN;
  if (top > maxTop) {
    top = Math.max(viewportTop + MARGIN, maxTop);
  }

  overlay.style.left = `${left}px`;
  overlay.style.top = `${top}px`;
}

function createOverlayShell() {
  removeOverlay();
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "reality-wall-overlay";
  document.body.appendChild(overlay);
  return overlay;
}

function bindClose(overlay) {
  const closeButton = overlay.querySelector(".rw-close");
  if (closeButton) {
    closeButton.addEventListener("click", removeOverlay);
  }
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function renderLoading() {
  const overlay = createOverlayShell();
  overlay.innerHTML = `
    <div class="rw-header">
      <span class="rw-title">RealityWall</span>
      <button type="button" class="rw-close" aria-label="Fermer">&times;</button>
    </div>
    <div class="rw-body rw-loading">
      <div class="rw-spinner" aria-hidden="true"></div>
      <p>Recherche de sources et analyse en cours…</p>
    </div>
  `;
  positionOverlay(overlay);
  bindClose(overlay);
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

function renderRhetoriqueSection(rhetorique) {
  if (!Array.isArray(rhetorique) || rhetorique.length === 0) {
    return '<p class="rw-empty">Aucun sophisme rhétorique flagrant détecté.</p>';
  }

  const items = rhetorique
    .map(
      (item) => `
      <li class="rw-rhet-item">
        <span class="rw-badge rw-badge-red">${escapeHtml(item.type)}</span>
        <p>${escapeHtml(item.explication)}</p>
      </li>
    `
    )
    .join("");

  return `<ul class="rw-rhet-list">${items}</ul>`;
}

function renderContexteSection(contexte) {
  const data = contexte || {};
  if (!data.probleme_detecte) {
    return '<p class="rw-empty">Aucun élément de contexte manquant détecté.</p>';
  }
  return `
    <div class="rw-context">
      <span class="rw-badge rw-badge-yellow">Contexte incomplet</span>
      <p>${escapeHtml(data.explication)}</p>
    </div>
  `;
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

function renderSourcesSection(sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return '<p class="rw-empty">Aucune source trouvée pour ce texte.</p>';
  }

  const items = sources
    .map(
      (source) => `
      <li class="rw-source-item">
        ${
          isSafeHttpUrl(source.url)
            ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.url)}</a>`
            : `<span>${escapeHtml(source.url)}</span>`
        }
        <p>${escapeHtml(source.description)}</p>
      </li>
    `
    )
    .join("");

  return `<ul class="rw-source-list">${items}</ul>`;
}

function renderResult(data) {
  const overlay = createOverlayShell();

  overlay.innerHTML = `
    <div class="rw-header">
      <span class="rw-title">RealityWall</span>
      <button type="button" class="rw-close" aria-label="Fermer">&times;</button>
    </div>
    <div class="rw-body">
      <div class="rw-section">
        <span class="rw-label">Statut</span>
        <span class="rw-badge ${statutBadgeClass(data.statut)}">${escapeHtml(data.statut)}</span>
      </div>
      <div class="rw-section">
        <span class="rw-label">Rhétorique</span>
        ${renderRhetoriqueSection(data.rhetorique)}
      </div>
      <div class="rw-section">
        <span class="rw-label">Contexte</span>
        ${renderContexteSection(data.contexte)}
      </div>
      <div class="rw-section">
        <span class="rw-label">Sources</span>
        ${renderSourcesSection(data.sources)}
      </div>
      <p class="rw-disclaimer">
        Analyse automatique par IA, susceptible d'erreurs : vérifiez les
        sources avant de vous y fier.
      </p>
    </div>
  `;

  positionOverlay(overlay);
  bindClose(overlay);
}

function renderError(message) {
  const overlay = createOverlayShell();
  overlay.innerHTML = `
    <div class="rw-header">
      <span class="rw-title">RealityWall</span>
      <button type="button" class="rw-close" aria-label="Fermer">&times;</button>
    </div>
    <div class="rw-body">
      <p class="rw-error">Erreur : ${escapeHtml(message)}</p>
      <p class="rw-error-hint">
        Vérifiez votre clé API Anthropic dans la page de réglages de
        l'extension.
      </p>
    </div>
  `;
  positionOverlay(overlay);
  bindClose(overlay);
}

api.runtime.onMessage.addListener((message) => {
  if (!message || typeof message.type !== "string") {
    return;
  }

  if (message.type === "REALITYWALL_LOADING") {
    renderLoading();
  } else if (message.type === "REALITYWALL_RESULT") {
    renderResult(message.payload);
  } else if (message.type === "REALITYWALL_ERROR") {
    renderError(message.message);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    removeOverlay();
  }
});
