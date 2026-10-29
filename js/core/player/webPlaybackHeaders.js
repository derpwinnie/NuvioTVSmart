const BROWSER_RESTRICTED_HEADER_NAMES = new Set([
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "cookie",
  "cookie2",
  "date",
  "dnt",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "permissions-policy",
  "range",
  "referer",
  "referrer",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "user-agent",
  "via"
]);

function normalizeHeaderEntries(headers = {}) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return [];
  }
  return Object.entries(headers)
    .map(([name, value]) => [String(name || "").trim(), String(value ?? "").trim()])
    .filter(([name, value]) => name && value)
    .filter(([name, value]) => !name.includes("\r") && !name.includes("\n") && !value.includes("\r") && !value.includes("\n"));
}

export function isBrowserRestrictedPlaybackHeader(name = "") {
  const normalized = String(name || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return true;
  }
  if (normalized.startsWith("sec-") || normalized.startsWith("proxy-")) {
    return true;
  }
  return BROWSER_RESTRICTED_HEADER_NAMES.has(normalized);
}

export function classifyWebPlaybackHeaders(headers = {}) {
  const forwardableHeaders = {};
  const declaredHeaderNames = [];
  const restrictedHeaderNames = [];

  normalizeHeaderEntries(headers).forEach(([name, value]) => {
    declaredHeaderNames.push(name);
    if (isBrowserRestrictedPlaybackHeader(name)) {
      restrictedHeaderNames.push(name);
      return;
    }
    forwardableHeaders[name] = value;
  });

  return {
    forwardableHeaders,
    declaredHeaderNames,
    restrictedHeaderNames
  };
}

export function normalizeNotWebReady(value) {
  return (
    value === true ||
    String(value || "")
      .trim()
      .toLowerCase() === "true"
  );
}

function mediaFlowUrlForwardsRestrictedHeaders(headers, playbackUrl) {
  try {
    const url = new URL(String(playbackUrl || ""));
    if (!["http:", "https:"].includes(url.protocol) || url.pathname !== "/proxy/stream") return false;
    const parameterNames = new Set();
    const embeddedHeaders = new Map();
    for (const [name, value] of url.searchParams) {
      const normalizedName = name.toLowerCase();
      if (parameterNames.has(normalizedName)) return false;
      parameterNames.add(normalizedName);
      // no_proxy bypasses MediaFlow's upstream request-header forwarding.
      if (normalizedName === "no_proxy") return false;
      if (!name.startsWith("h_")) continue;
      const headerName = name.slice(2);
      if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(headerName) || /[\r\n]/.test(value)) return false;
      embeddedHeaders.set(headerName.toLowerCase(), value);
    }
    const destination = new URL(url.searchParams.get("d") || "");
    if (!["http:", "https:"].includes(destination.protocol)) return false;
    const declaredEntries = normalizeHeaderEntries(headers);
    if (declaredEntries.length !== Object.keys(headers).length) return false;
    const declaredNames = new Set();
    let matchedRestrictedHeader = false;
    for (const [name, value] of declaredEntries) {
      const normalizedName = name.toLowerCase();
      if (declaredNames.has(normalizedName)) return false;
      declaredNames.add(normalizedName);
      if (!isBrowserRestrictedPlaybackHeader(name)) continue;
      if (embeddedHeaders.get(normalizedName) !== value) return false;
      matchedRestrictedHeader = true;
    }
    return matchedRestrictedHeader;
  } catch (_) {
    return false;
  }
}

export function getStandaloneWebPlaybackCompatibility(headers = {}, notWebReady = false, { playbackUrl = "" } = {}) {
  const classification = classifyWebPlaybackHeaders(headers);
  const normalizedNotWebReady = normalizeNotWebReady(notWebReady);
  // MediaFlow's /proxy/stream accepts h_<header> query parameters server-side.
  // Accept only a complete, unambiguous match; notWebReady alone stays binding.
  const proxyHandlesRestrictedHeaders =
    classification.restrictedHeaderNames.length > 0 && mediaFlowUrlForwardsRestrictedHeaders(headers, playbackUrl);
  const unsupportedStandalone = normalizedNotWebReady && classification.restrictedHeaderNames.length > 0 && !proxyHandlesRestrictedHeaders;

  return {
    ...classification,
    notWebReady: normalizedNotWebReady,
    compatible: !unsupportedStandalone,
    standaloneCompatibility: unsupportedStandalone
      ? "unsupported standalone web stream"
      : proxyHandlesRestrictedHeaders
        ? "compatible MediaFlow proxy stream"
        : classification.restrictedHeaderNames.length
          ? "direct playback attempt allowed"
          : "compatible standalone web stream"
  };
}

export function createWebPlaybackHeaderDiagnosticSnapshot(
  headers = {},
  { notWebReady = false, playbackEngine = "", playbackUrl = "" } = {}
) {
  const compatibility = getStandaloneWebPlaybackCompatibility(headers, notWebReady, { playbackUrl });
  const browserSafeHeaderNames = Object.keys(compatibility.forwardableHeaders);
  const engine = String(playbackEngine || "")
    .trim()
    .toLowerCase();

  return {
    declaredHeaderNames: [...compatibility.declaredHeaderNames],
    browserSafeHeaderNames,
    forwardedHeaderNames: ["hls.js", "dash.js"].includes(engine) ? [...browserSafeHeaderNames] : [],
    restrictedHeaderNames: [...compatibility.restrictedHeaderNames],
    notWebReady: compatibility.notWebReady,
    standaloneCompatibility: compatibility.standaloneCompatibility
  };
}
