// Dashboard client. Talks to the local JSON API; holds no secrets itself.
const $ = (id) => document.getElementById(id);
const api = async (method, path, body) => {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
};
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
const msg = (el, text, ok) => {
  el.textContent = text;
  el.className = "msg " + (ok ? "ok" : "err");
};

let selectedHost = null;

async function refreshStatus() {
  const s = await api("GET", "/api/status");
  const need = s.secrets;
  const ready = need.ready ?? !(need.needApk || need.needPassphrase || need.needConstants);
  $("setup-steps").hidden = ready;
  $("secrets-status").textContent = ready
    ? "✓ Setup complete" + (need.source === "sidee" ? " (certificate from Sidee)." : ".")
    : "Not set up yet.";
  // Already paired TVs can go straight to installing.
  if (ready && s.tvs && s.tvs.length && !selectedHost) {
    selectedHost = s.tvs[0];
    $("sec-install").hidden = false;
    $("install-host").textContent = selectedHost;
    loadTiles();
  }
  return need;
}

$("sidee-btn").onclick = async () => {
  $("sidee-btn").disabled = true;
  msg($("secrets-msg"), "Downloading and verifying…", true);
  const r = await api("POST", "/api/import-sidee");
  $("sidee-btn").disabled = false;
  msg($("secrets-msg"), r.ok ? "Done. Now find your TV." : r.error, r.ok);
  refreshStatus();
};

$("apk-btn").onclick = async () => {
  const r = await api("POST", "/api/import-apk", { apkPath: $("apk-path").value.trim() });
  msg($("secrets-msg"), r.ok ? "Keystores imported." : r.error, r.ok);
  refreshStatus();
};

$("secret-btn").onclick = async () => {
  const body = {};
  if ($("passphrase").value) body.passphrase = $("passphrase").value;
  if ($("constants").value.trim()) {
    try {
      body.constants = JSON.parse($("constants").value);
    } catch {
      return msg($("secrets-msg"), "Constants must be valid JSON.", false);
    }
  }
  const r = await api("POST", "/api/secret", body);
  msg($("secrets-msg"), r.ok ? "Setup saved." : r.error, r.ok);
  refreshStatus();
};

$("find-btn").onclick = async () => {
  msg($("find-msg"), "Searching…", true);
  const r = await api("POST", "/api/discover");
  const list = $("tv-list");
  list.innerHTML = "";
  if (!r.tvs || !r.tvs.length) {
    return msg(
      $("find-msg"),
      "No TV found. Same network? On Fedora, allow the discovery port in firewalld.",
      false
    );
  }
  msg($("find-msg"), "", true);
  r.tvs.forEach((tv) => {
    const d = document.createElement("div");
    d.innerHTML = `<button class="secondary">Pair</button> ${esc(tv.friendlyName || tv.host)} <span class="muted">${esc(tv.host)}</span>`;
    d.querySelector("button").onclick = () => startPair(tv.host);
    list.appendChild(d);
  });
};

const VERIFY_REASONS = {
  "no-descriptor":
    "No TV answered at this address. Check the IP in the TV's network settings and that both devices are on the same network.",
  "not-vidaa": "A device answered at this address, but it is not a VIDAA TV.",
  "port-closed":
    "The TV answered, but its pairing port (36669) is closed. Turn the TV fully on and try again."
};

$("manual-btn").onclick = async () => {
  const h = $("manual-host").value.trim();
  if (!h) return;
  msg($("find-msg"), `Checking ${h}…`, true);
  const r = await api("POST", "/api/verify-host", { host: h });
  if (r.ok) {
    msg($("find-msg"), "", true);
    startPair(h);
    return;
  }
  msg($("find-msg"), VERIFY_REASONS[r.reason] || r.error || "That address did not answer.", false);
};

function startPair(host) {
  selectedHost = host;
  $("pair-host").textContent = host;
  $("sec-pair").hidden = false;
  $("sec-pair").scrollIntoView({ behavior: "smooth" });
  msg($("pair-msg"), "", true);
}

$("pair-start").onclick = async () => {
  msg($("pair-msg"), "Asking the TV to show a PIN…", true);
  const r = await api("POST", "/api/pair/start", { host: selectedHost });
  msg($("pair-msg"), r.ok ? "Enter the PIN shown on your TV." : r.error, r.ok);
};

$("pin-submit").onclick = async () => {
  const r = await api("POST", "/api/pair/submit", { pin: $("pin").value.trim() });
  if (r.ok) {
    msg($("pair-msg"), "Paired.", true);
    $("install-host").textContent = selectedHost;
    $("sec-install").hidden = false;
    $("sec-install").scrollIntoView({ behavior: "smooth" });
    loadTiles();
  } else {
    msg($("pair-msg"), r.error || "Pairing failed.", false);
  }
};

async function loadTiles() {
  const r = await api("GET", "/api/tiles?host=" + encodeURIComponent(selectedHost));
  const box = $("tiles");
  box.innerHTML = "";
  // Show why the list is missing instead of an empty list.
  if (r.error) return msg($("install-msg"), "Could not list the tiles: " + r.error, false);
  (r.tiles || []).forEach((t) => {
    const d = document.createElement("div");
    d.innerHTML = `${esc(t.name || t.appId)} <span class="muted">${esc(t.url || t.appUrl || "")}</span> <button class="secondary">Remove</button>`;
    d.querySelector("button").onclick = async () => {
      const del = await api("DELETE", "/api/tiles", { host: selectedHost, appId: t.appId });
      if (del.error) return msg($("install-msg"), del.error, false);
      loadTiles();
    };
    box.appendChild(d);
  });
}

$("install-btn").onclick = async () => {
  msg($("install-msg"), "Installing…", true);
  const r = await api("POST", "/api/tiles", {
    host: selectedHost,
    url: $("tile-url").value.trim(),
    name: $("tile-name").value.trim() || "Nuvio"
  });
  msg($("install-msg"), r.ok ? "Done. Open the tile from your TV's launcher." : r.error, r.ok);
  if (r.ok) loadTiles();
};

refreshStatus();
