// Android leaves Sources when playback starts, so Back from the player returns to
// the screen that opened Sources (Home for Continue Watching, Detail, Library...).
// The web Router keeps Sources on its stack; on VIDAA skip over it the same way.
const SKIPPABLE_SOURCE_ROUTES = new Set(["stream"]);
const RETURN_ROUTES = new Set(["home", "detail", "library", "search", "discover"]);

function entryRoute(entry) {
  return typeof entry === "string" ? entry : String(entry?.route || "");
}

function entryParams(entry) {
  return typeof entry === "string" ? {} : entry?.params || {};
}

// Returns { route, params } for the screen below Sources, or null to keep the default.
export function getVidaaPlayerBackTarget(stack) {
  const entries = Array.isArray(stack) ? stack : [];
  if (entries.length < 2 || !SKIPPABLE_SOURCE_ROUTES.has(entryRoute(entries[entries.length - 1]))) {
    return null;
  }
  const below = entries[entries.length - 2];
  const route = entryRoute(below);
  return RETURN_ROUTES.has(route) ? { route, params: { ...entryParams(below) } } : null;
}
