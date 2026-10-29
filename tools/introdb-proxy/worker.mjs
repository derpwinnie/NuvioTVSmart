// Cloudflare Worker: read-only CORS proxy for IntroDB's segment lookup.
//
// The VIDAA build runs as a web page (GitHub Pages), and api.introdb.app only
// allows its own site as a browser origin, so the TV cannot read the answers.
// This worker forwards exactly one request shape (GET /segments with the
// parameters Nuvio sends), only for the Nuvio Pages origins, and caches the
// answers so IntroDB sees one request per title, not one per viewer.
// Delete it once IntroDB allows these origins itself (see README.md).

import { ALLOWED_ORIGINS, CACHE_SECONDS, corsHeaders, upstreamUrl } from "./segmentsRequest.mjs";

export default {
  async fetch(request, _env, ctx) {
    const origin = request.headers.get("Origin") || "";
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return new Response("forbidden", { status: 403 });
    }
    const cors = corsHeaders(origin);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "GET") {
      return new Response("method not allowed", { status: 405, headers: cors });
    }
    const target = upstreamUrl(request.url);
    if (!target) {
      return new Response("bad request", { status: 400, headers: cors });
    }

    const cache = caches.default;
    const cacheKey = new Request(target, { method: "GET" });
    let response = await cache.match(cacheKey);
    if (!response) {
      const upstream = await fetch(target, { headers: { Accept: "application/json" } });
      // 404 means "no segments for this title" and is worth caching too.
      if (!upstream.ok && upstream.status !== 404) {
        return new Response("upstream error", { status: 502, headers: cors });
      }
      response = new Response(upstream.body, {
        status: upstream.status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": `public, max-age=${CACHE_SECONDS}`
        }
      });
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }
    const out = new Response(response.body, response);
    for (const [key, value] of Object.entries(cors)) out.headers.set(key, value);
    return out;
  }
};
