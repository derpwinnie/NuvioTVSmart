// Request rules for the IntroDB proxy (worker.mjs). Kept apart because a
// Worker module may only export handlers.

export const UPSTREAM = "https://api.introdb.app/segments";
export const ALLOWED_ORIGINS = ["https://derpwinnie.github.io", "https://kvnshroom.github.io"];
export const CACHE_SECONDS = 6 * 3600;

export function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

// Only the parameters skipIntroRepository.js sends, in a fixed order, so
// equal lookups share one cache entry. Returns null for anything else.
export function upstreamUrl(requestUrl) {
  const url = new URL(requestUrl);
  if (url.pathname !== "/segments") return null;
  const imdbId = url.searchParams.get("imdb_id") || "";
  if (!/^tt\d{1,10}$/.test(imdbId)) return null;
  const target = new URL(UPSTREAM);
  target.searchParams.set("imdb_id", imdbId);
  if (url.searchParams.get("is_movie") === "true") {
    target.searchParams.set("is_movie", "true");
    return target.toString();
  }
  const season = url.searchParams.get("season") || "";
  const episode = url.searchParams.get("episode") || "";
  if (!/^\d{1,4}$/.test(season) || !/^\d{1,5}$/.test(episode)) return null;
  target.searchParams.set("season", season);
  target.searchParams.set("episode", episode);
  return target.toString();
}
