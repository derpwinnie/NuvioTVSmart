// The IntroDB CORS proxy worker, with fetch and the Cloudflare cache faked.
import assert from "node:assert/strict";

const cached = new Map();
globalThis.caches = {
  default: {
    match: async (req) => cached.get(req.url)?.clone(),
    put: async (req, res) => cached.set(req.url, res)
  }
};
const upstreamCalls = [];
globalThis.fetch = async (url) => {
  upstreamCalls.push(url);
  if (url.includes("tt404")) return new Response("{}", { status: 404 });
  if (url.includes("tt500")) return new Response("down", { status: 500 });
  return new Response(JSON.stringify({ intro: { start_sec: 1, end_sec: 2 } }), { status: 200 });
};

const { default: worker } = await import("../tools/introdb-proxy/worker.mjs");
const { upstreamUrl } = await import("../tools/introdb-proxy/segmentsRequest.mjs");
const ctx = { waitUntil: (p) => p };
const ORIGIN = "https://derpwinnie.github.io";
const call = (path, { origin = ORIGIN, method = "GET" } = {}) =>
  worker.fetch(
    new Request(`https://proxy.example${path}`, {
      method,
      headers: origin ? { Origin: origin } : {}
    }),
    {},
    ctx
  );

// Only the shapes Nuvio sends reach IntroDB, normalized.
assert.equal(
  upstreamUrl("https://p/segments?episode=2&season=1&imdb_id=tt0903747&x=1"),
  "https://api.introdb.app/segments?imdb_id=tt0903747&season=1&episode=2"
);
assert.equal(
  upstreamUrl("https://p/segments?imdb_id=tt1&is_movie=true"),
  "https://api.introdb.app/segments?imdb_id=tt1&is_movie=true"
);
for (const bad of [
  "/segments?imdb_id=x1",
  "/segments?imdb_id=tt1",
  "/segments?imdb_id=tt1&season=a&episode=1",
  "/other?imdb_id=tt1&season=1&episode=1"
]) {
  assert.equal(upstreamUrl(`https://p${bad}`), null, bad);
}

// Allowed origin: answer with CORS, cached after the first request.
let res = await call("/segments?imdb_id=tt0903747&season=1&episode=2");
assert.equal(res.status, 200);
assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
assert.deepEqual(await res.json(), { intro: { start_sec: 1, end_sec: 2 } });
res = await call("/segments?imdb_id=tt0903747&season=1&episode=2", {
  origin: "https://kvnshroom.github.io"
});
assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://kvnshroom.github.io");
assert.equal(upstreamCalls.length, 1, "the second viewer is served from the cache");

// "No segments" is cached as well; upstream failures are not.
assert.equal((await call("/segments?imdb_id=tt404&season=1&episode=1")).status, 404);
assert.equal((await call("/segments?imdb_id=tt500&season=1&episode=1")).status, 502);
assert.equal((await call("/segments?imdb_id=tt500&season=1&episode=1")).status, 502);
assert.equal(upstreamCalls.filter((u) => u.includes("tt500")).length, 2);

// Preflight, wrong method, other origins, other paths.
res = await call("/segments?imdb_id=tt1&season=1&episode=1", { method: "OPTIONS" });
assert.equal(res.status, 204);
assert.equal(res.headers.get("Access-Control-Allow-Methods"), "GET, OPTIONS");
assert.equal(
  (await call("/segments?imdb_id=tt1&season=1&episode=1", { method: "POST" })).status,
  405
);
assert.equal(
  (await call("/segments?imdb_id=tt1&season=1&episode=1", { origin: "https://evil.example" }))
    .status,
  403
);
assert.equal((await call("/segments?imdb_id=tt1&season=1&episode=1", { origin: "" })).status, 403);
assert.equal((await call("/admin")).status, 400);

console.log("IntroDB proxy checks passed: request shapes, CORS origins, caching, errors.");
