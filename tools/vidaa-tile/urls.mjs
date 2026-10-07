// Validation for the URL a tile opens on the TV.
//
// The TV reaches this URL over the network, so loopback is useless and plain
// http is only sensible on a trusted private network. Public sites must use
// https. Credentials in the URL are rejected.

// Free hosted build of this fork (GitHub Pages), so nobody has to self-host.
export const DEFAULT_TILE_URL = "https://derpwinnie.github.io/NuvioTVSmart/vidaa.html";

const PRIVATE = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  // Tailscale / CGNAT 100.64.0.0/10
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./
];

const isLoopback = (h) => h === "localhost" || /^127\./.test(h) || h === "::1";
const isPrivate = (h) => PRIVATE.some((re) => re.test(h));

export function validateTileUrl(input) {
  let u;
  try {
    u = new URL(String(input).trim());
  } catch {
    return { ok: false, reason: "not a URL" };
  }
  if (u.username || u.password) {
    return { ok: false, reason: "URL must not contain credentials" };
  }
  if (u.protocol === "https:") return { ok: true, url: u.href };
  if (u.protocol === "http:") {
    if (isLoopback(u.hostname)) {
      return { ok: false, reason: "loopback is not reachable from the TV" };
    }
    if (isPrivate(u.hostname)) return { ok: true, url: u.href };
    return { ok: false, reason: "plain http is only allowed on your private network" };
  }
  return { ok: false, reason: "only http and https are allowed" };
}

export function withVidaaWrapper(url) {
  const u = new URL(url);
  if (!u.searchParams.has("wrapper")) u.searchParams.set("wrapper", "vidaa");
  return u.href;
}
