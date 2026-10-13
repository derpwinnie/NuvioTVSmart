import { renderBrandWordmarkImage } from "./brandWordmark.js";

let loadingIndicatorSequence = 0;

// Literal SVG stop colors also support TV engines without CSS variables.
// Theme changes update mounted gradients; new nodes use the resolved palette.
let loadingAccentColors = ["#f5f5f5"];

export function syncLoadingIndicatorPalette(palette) {
  loadingAccentColors = String(palette["--accent-gradient"] || palette["--secondary-color"]).match(
    /#[0-9a-f]{6}/gi
  ) || ["#f5f5f5"];
  document.querySelectorAll(".nuvio-loading-gradient").forEach((gradient) => {
    while (gradient.firstChild) gradient.removeChild(gradient.firstChild);
    loadingAccentColors.forEach((color, index) => {
      const stop = document.createElementNS("http://www.w3.org/2000/svg", "stop");
      stop.setAttribute(
        "offset",
        loadingAccentColors.length === 1 ? 0 : index / (loadingAccentColors.length - 1)
      );
      stop.setAttribute("stop-color", color);
      gradient.appendChild(stop);
    });
  });
}

function renderGradientStops() {
  return loadingAccentColors
    .map(
      (color, index) =>
        `<stop offset="${loadingAccentColors.length === 1 ? 0 : index / (loadingAccentColors.length - 1)}" stop-color="${color}"/>`
    )
    .join("");
}

function escapeAttribute(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderLogoLoadingMarkup(options = {}) {
  const className = String(options?.className || "").trim();
  const label = String(options?.label || "Loading").trim() || "Loading";
  return `
    <div class="app-loading-screen${className ? ` ${escapeAttribute(className)}` : ""}" aria-label="${escapeAttribute(label)}">
      ${renderBrandWordmarkImage({ className: "app-loading-logo" })}
    </div>
  `;
}

export function renderLoadingIndicator(options = {}) {
  const className = String(options?.className || "").trim();
  const label = String(options?.label || "").trim();
  const gradientId = `nuvio-loading-gradient-${++loadingIndicatorSequence}`;
  const color = String(options?.color || "").trim();
  const solidColor = /^#[0-9a-f]{6}$/i.test(color) ? color : null;
  const accessibilityAttribute = label
    ? `role="status" aria-label="${escapeAttribute(label)}"`
    : 'aria-hidden="true"';

  return `
    <span class="nuvio-loading-indicator${className ? ` ${escapeAttribute(className)}` : ""}" ${accessibilityAttribute}>
      <svg class="nuvio-loading-indicator-svg" viewBox="0 0 350 350" aria-hidden="true" focusable="false">
        <defs><linearGradient id="${gradientId}" class="nuvio-loading-gradient" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="350" y2="350">${renderGradientStops()}</linearGradient></defs>
        <circle class="nuvio-loading-indicator-arc" cx="175" cy="175" r="112.5" fill="none" stroke="${solidColor || `url(#${gradientId})`}" stroke-width="37.5" stroke-linecap="round"/>
      </svg>
    </span>
  `;
}

export function createLoadingIndicator(text = "Loading...") {
  const node = document.createElement("div");
  node.className = "card";
  node.innerHTML = `
    ${renderLoadingIndicator({ label: text })}
    <p>${text}</p>
  `;
  return node;
}
