import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

console.log("=== Running Nuvio TV VIDAA Platform Tests ===");

// 1. Test platform detection & adapter methods
{
  console.log("\n[Test 1] Platform detection and adapter interface");

  // Mock global browser environment
  globalThis.__NUVIO_PLATFORM__ = "vidaa";
  globalThis.document = {
    head: { appendChild: () => {} },
    querySelector: () => null,
    createElement: () => ({ setAttribute: () => {}, appendChild: () => {} }),
    documentElement: { classList: { add: () => {} } },
    body: { classList: { add: () => {} } },
    addEventListener: () => {},
    dispatchEvent: () => {}
  };
  globalThis.location = { search: "" };
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "Mozilla/5.0 (VIDAA/7.0; Hisense 65U7Q)" },
    configurable: true,
    writable: true
  });

  let exitCalled = false;
  globalThis.Hisense_Exit = () => {
    exitCalled = true;
  };
  globalThis.Hisense_GetModelName = () => "Hisense 65U7Q";
  globalThis.Hisense_GetOSVersion = () => "VIDAA U7";

  const insecureDomains = [];
  globalThis.Hisense_AddInsecureDomain = (host) => insecureDomains.push(host);

  const { Platform } = await import("../js/platform/index.js");
  Platform.current = null; // force re-evaluation

  assert.equal(Platform.getName(), "vidaa", "Platform name must be vidaa");
  assert.equal(Platform.isVidaa(), true, "Platform.isVidaa() must return true");
  assert.equal(Platform.isTizen(), false, "Platform.isTizen() must return false on vidaa");
  assert.equal(Platform.isWebOS(), false, "Platform.isWebOS() must return false on vidaa");
  assert.equal(Platform.isBrowser(), false, "Platform.isBrowser() must return false on vidaa");

  // Capabilities
  const caps = Platform.getCapabilities();
  assert.equal(caps.nativeVideo, true, "nativeVideo capability must be true");

  // Device label
  const label = Platform.getDeviceLabel();
  assert.ok(label.includes("65U7Q"), `Device label should include model: ${label}`);

  // Exit App
  Platform.exitApp();
  assert.equal(exitCalled, true, "Hisense_Exit must be called on exitApp()");

  // Back event detection
  assert.equal(
    Platform.isBackEvent({ keyCode: 8 }),
    true,
    "KeyCode 8 (Backspace) must be back event"
  );
  assert.equal(
    Platform.isBackEvent({ keyCode: 461 }),
    true,
    "KeyCode 461 (webOS/VIDAA back) must be back event"
  );
  assert.equal(
    Platform.isBackEvent({ keyCode: 10009 }),
    true,
    "KeyCode 10009 (Tizen/VIDAA back) must be back event"
  );
  assert.equal(
    Platform.isBackEvent({ keyCode: 27 }),
    true,
    "KeyCode 27 (Escape) must be back event"
  );
  assert.equal(Platform.isBackEvent({ key: "Back" }), true, "Key 'Back' must be back event");
  assert.equal(Platform.isBackEvent({ key: "GoBack" }), true, "Key 'GoBack' must be back event");
  assert.equal(
    Platform.isBackEvent({ keyCode: 13 }),
    false,
    "KeyCode 13 (Enter) must NOT be back event"
  );

  // Key normalization
  const normalizedEnter = Platform.normalizeKey({ keyCode: 13, key: "Enter" });
  assert.equal(normalizedEnter.isEnter, true, "Enter key must normalize to isEnter: true");

  const normalizedBack = Platform.normalizeKey({ keyCode: 461 });
  assert.equal(normalizedBack.isBack, true, "Keycode 461 must normalize to isBack: true");

  // Plain-HTTP media hosts must be allowed before playback; HTTPS needs nothing.
  Platform.prepareMediaRequest("http://192.168.1.20:8080/movie.mkv");
  Platform.prepareMediaRequest("https://example.com/movie.mkv");
  assert.deepEqual(insecureDomains, ["192.168.1.20"], "Only http media hosts are registered");

  console.log("✓ Platform detection and adapter methods passed");
}

// 2. Test Environment abstraction
{
  console.log("\n[Test 2] Environment abstraction");
  const { Environment } = await import("../js/platform/environment.js");
  assert.equal(Environment.isVidaa(), true, "Environment.isVidaa() must return true");
  assert.equal(Environment.isWebOS(), false, "Environment.isWebOS() must return false");
  assert.equal(Environment.isTizen(), false, "Environment.isTizen() must return false");
  console.log("✓ Environment abstraction passed");
}

// 3. Test Plugin Policy on VIDAA
{
  console.log("\n[Test 3] Plugin Policy on VIDAA");
  globalThis.Worker = class DummyWorker {};
  globalThis.WebAssembly = {};

  const { getPluginCapabilitySnapshot } = await import("../js/core/player/pluginPolicy.js");
  const snapshot = getPluginCapabilitySnapshot();

  assert.equal(snapshot.platform, "vidaa", "Snapshot platform must be vidaa");
  assert.equal(snapshot.appSupported, true, "appSupported must be true on VIDAA");
  assert.equal(snapshot.normalAddonsSupported, true, "normalAddonsSupported must be true on VIDAA");
  assert.equal(snapshot.candidate, true, "candidate must be true on VIDAA");
  assert.equal(snapshot.precheckPassed, true, "precheckPassed must be true on VIDAA");

  console.log("✓ Plugin Policy passed");
}

// 4. Test Plugin Service Client on VIDAA
{
  console.log("\n[Test 4] Plugin Service Client on VIDAA");
  const { PluginServiceClient } = await import("../js/platform/pluginServiceClient.js");
  const health = await PluginServiceClient.health({ force: true });

  assert.equal(health.returnValue, true, "PluginServiceClient health must be true on VIDAA");
  assert.equal(health.status, "vidaa", "Health status must be vidaa");
  assert.equal(health.workerSupport, true, "workerSupport must be true");

  console.log("✓ Plugin Service Client passed");
}

// 5. Test Virtual Keyboard Fix
{
  console.log("\n[Test 5] VIDAA Virtual Keyboard Input Bug Fix");

  const listeners = {};
  const intervals = [];
  const root = {
    document: {
      hidden: false,
      activeElement: null,
      addEventListener: (name, fn) => (listeners[name] ||= []).push(fn)
    },
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    setInterval: (fn) => intervals.push(fn) - 1,
    clearInterval: () => {},
    addEventListener: () => {}
  };
  const fire = (name, target) => (listeners[name] || []).forEach((fn) => fn({ target }));
  const field = {
    tagName: "INPUT",
    type: "search",
    value: "",
    events: [],
    dispatchEvent(ev) {
      this.events.push(ev.type);
      fire(ev.type, this);
    }
  };

  const { installVidaaKeyboardFix } = await import("../js/platform/vidaa/vidaaKeyboard.js");
  installVidaaKeyboardFix(root);
  root.document.activeElement = field;
  fire("focusin", field);
  assert.equal(intervals.length, 1, "Only the focused text field is polled");

  // The VIDAA keyboard writes the value without firing DOM events: emit
  // input while editing and a single change when editing ends.
  field.value = "Avatar";
  intervals[0]();
  assert.deepEqual(field.events, ["input"], "Synthetic input once per silent value change");
  intervals[0]();
  assert.deepEqual(field.events, ["input"], "No duplicate events without a new value");

  // App code that sets the value and fires its own input must not be echoed.
  field.value = "Avatar 2";
  fire("input", field);
  intervals[0]();
  assert.deepEqual(field.events, ["input"], "Own input events are not repeated");

  // Closing the keyboard commits exactly one change event.
  root.document.activeElement = null;
  fire("focusout", field);
  assert.deepEqual(field.events, ["input", "change"], "One change on commit");
  fire("focusout", field);
  assert.deepEqual(field.events, ["input", "change"], "No duplicate change on repeated focusout");

  console.log("✓ Virtual keyboard bug fix verified");
}

// 6. Test Build and Package Artifacts
{
  console.log("\n[Test 6] Build and Packaging Verification");

  const vidaaDistDir = path.join(rootDir, "dist", "vidaa");
  const zipPath = path.join(rootDir, "dist", "nuvio-vidaa.zip");

  const requiredFiles = [
    path.join(vidaaDistDir, "index.html"),
    path.join(vidaaDistDir, "vidaa.html"),
    path.join(vidaaDistDir, "sw.js"),
    path.join(vidaaDistDir, "manifest.json"),
    path.join(vidaaDistDir, "app.bundle.js"),
    path.join(vidaaDistDir, "core-js.bundle.js"),
    path.join(vidaaDistDir, "boot-guard.js"),
    path.join(vidaaDistDir, "installer", "README.md"),
    path.join(vidaaDistDir, "installer", "legacy", "server.py"),
    path.join(vidaaDistDir, "installer", "legacy", "index.html"),
    path.join(vidaaDistDir, "installer", "legacy", "README.md")
  ];

  for (const filePath of requiredFiles) {
    const s = await fs.stat(filePath).catch(() => null);
    assert.ok(s && s.isFile(), `Required file must exist: ${filePath}`);
  }

  const zipStat = await fs.stat(zipPath).catch(() => null);
  assert.ok(
    zipStat && zipStat.size > 1000000,
    `nuvio-vidaa.zip must exist and be > 1MB (${zipStat?.size} bytes)`
  );

  // Verify index.html contains the VIDAA bootloader script
  const indexContent = await fs.readFile(path.join(vidaaDistDir, "index.html"), "utf8");
  assert.ok(
    indexContent.includes("configureVidaaLaunch"),
    "index.html must include configureVidaaLaunch"
  );
  assert.ok(indexContent.includes("sw.js"), "index.html must register sw.js");
  assert.ok(
    !indexContent.includes('<link rel="manifest"'),
    "manifest.json is only linked at runtime on VIDAA, never statically"
  );

  // Each build gets its own asset names and offline cache so the TV cannot
  // combine an old cached shell with new code.
  const buildId = indexContent.match(/app\.bundle\.([0-9a-f]{16})\.js/)?.[1];
  assert.ok(buildId, "index.html must reference a hashed app bundle");
  const worker = await fs.readFile(path.join(vidaaDistDir, "sw.js"), "utf8");
  assert.ok(
    worker.includes(`var CACHE_NAME = "nuvio-vidaa-${buildId}";`),
    "sw.js cache name must match the build id"
  );
  assert.ok(worker.includes(`./app.bundle.${buildId}.js`), "sw.js must precache hashed assets");
  const entry = await fs.readFile(path.join(vidaaDistDir, "vidaa.html"), "utf8");
  assert.ok(
    entry.includes('window.__NUVIO_PLATFORM__ = "vidaa"'),
    "vidaa.html must force VIDAA mode"
  );

  // The shared dist feeds the Tizen and webOS packages and must stay SW-free.
  const sharedWorker = await fs.stat(path.join(rootDir, "dist", "sw.js")).catch(() => null);
  assert.equal(sharedWorker, null, "dist/sw.js must not exist outside dist/vidaa");

  console.log(
    `✓ Packaging verified: nuvio-vidaa.zip is ${(zipStat.size / (1024 * 1024)).toFixed(2)} MB`
  );
}

// 7. Test TV Runtime Performance Profile & Default Supabase Env
{
  console.log("\n[Test 7] TV Runtime Performance Profile & Default Backend Configuration");
  const { getTvRuntimePerformanceProfile, resetTvRuntimePerformanceProfile } =
    await import("../js/platform/tvRuntimePerformance.js");
  resetTvRuntimePerformanceProfile();
  const profile = getTvRuntimePerformanceProfile({ forceRefresh: true });

  assert.equal(profile.isTvRuntime, true, "profile.isTvRuntime must be true on VIDAA");
  assert.equal(profile.platform, "vidaa", "profile.platform must be 'vidaa'");
  assert.equal(
    profile.isPerformanceConstrained,
    true,
    "profile.isPerformanceConstrained must be true to enable immediate focus scroll"
  );

  const { readEnvProperties } = await import("../scripts/envProperties.mjs");
  const envResult = await readEnvProperties({ rootDir });
  assert.equal(
    envResult.env.NUVIO_SUPABASE_URL,
    "https://api.nuvio.tv",
    "Default NUVIO_SUPABASE_URL must be https://api.nuvio.tv"
  );
  assert.ok(
    envResult.env.NUVIO_SUPABASE_ANON_KEY.length > 20,
    "Default NUVIO_SUPABASE_ANON_KEY must be populated"
  );

  console.log("✓ TV Runtime Profile & Default Backend Configuration passed");
}

console.log("\n=======================================================");
console.log("  ALL VIDAA OS PORT TESTS PASSED SUCCESSFULLY! (7/7)");
console.log("=======================================================\n");
