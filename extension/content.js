/**
 * Content script RealityWall.
 *
 * Affiche l'overlay de résultat au niveau du curseur, sans dépendance
 * externe ni framework : DOM natif et CSS scoping par préfixe `rw-`.
 */

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
      <p>Analyse en cours…</p>
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

function renderVerificationSection(verification) {
  if (!verification) {
    return '<p class="rw-empty">Aucune vérification pertinente pour ce texte.</p>';
  }
  return `
    <div class="rw-verification">
      <code>${escapeHtml(verification)}</code>
      <button type="button" class="rw-copy">Copier</button>
    </div>
  `;
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
        <span class="rw-label">Pièce à conviction</span>
        ${renderVerificationSection(data.verification)}
      </div>
    </div>
  `;

  positionOverlay(overlay);
  bindClose(overlay);

  const copyButton = overlay.querySelector(".rw-copy");
  if (copyButton) {
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(data.verification || "");
        copyButton.textContent = "Copié !";
      } catch (error) {
        copyButton.textContent = "Erreur";
      }
      setTimeout(() => {
        copyButton.textContent = "Copier";
      }, 1500);
    });
  }
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
        Vérifiez que le backend RealityWall est démarré et accessible
        (voir la page de réglages de l'extension).
      </p>
    </div>
  `;
  positionOverlay(overlay);
  bindClose(overlay);
}

chrome.runtime.onMessage.addListener((message) => {
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
