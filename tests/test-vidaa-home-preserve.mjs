import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// VIDAA keeps the rendered Home alive between routes like Tizen and webOS
// (upstream preserveRenderedTvHome; Empi 2483a4fc enabled it on a real VIDAA TV).
// Harness copied from js/ui/screens/home/homeArtworkRetention.test.mjs.
const source = await readFile(
  new URL("../js/ui/screens/home/homeScreenMethods-30-cleanup.js", import.meta.url),
  "utf8"
);
const mountSource = await readFile(
  new URL("../js/ui/screens/home/homeScreenMethods-20-mount.js", import.meta.url),
  "utf8"
);

function buildScreen({
  platform = "tizen",
  rows = [{}],
  hasLoadedOnce = true,
  childNodes = 1
} = {}) {
  const calls = { released: 0, reset: 0, hidden: 0, position: "", classes: [] };
  const classList = {
    add(token) {
      calls.classes.push(`add:${token}`);
    },
    remove(token) {
      calls.classes.push(`remove:${token}`);
    }
  };
  const styleStore = new Map();
  const container = {
    childNodes: Array.from({ length: childNodes }),
    classList,
    style: {
      position: "",
      top: "",
      right: "",
      bottom: "",
      left: "",
      visibility: "",
      pointerEvents: "",
      setProperty(name, value) {
        styleStore.set(name, value);
      },
      removeProperty(name) {
        styleStore.delete(name);
      }
    }
  };
  const context = vm.createContext({
    console,
    Platform: { isVidaa: () => platform === "vidaa" },
    cancelVidaaHomePosterPrefetches: () => {},
    setTimeout,
    clearTimeout,
    internals: {
      ScreenUtils: {
        hide() {
          calls.hidden += 1;
        }
      },
      Platform: {
        isTizen: () => platform === "tizen",
        isWebOS: () => platform === "webos",
        isVidaa: () => platform === "vidaa"
      }
    },
    resetHomeArtworkRescaler() {
      calls.reset += 1;
    }
  });
  context.globalThis = context;
  vm.runInContext(
    source
      .replace(/^import [\s\S]*?";$/m, "")
      .replace(/^import [^;]+;$/gm, "")
      .replace(/^export /gm, "") + "\nglobalThis.__cleanup = createHomeScreenMethods30();",
    context
  );
  const screen = Object.assign(Object.create(context.__cleanup), {
    container,
    rows,
    hasLoadedOnce,
    homeDomPreserved: false,
    releaseAllHomeLazyImages() {
      calls.released += 1;
      return 0;
    }
  });
  [
    "cancelFocusedPosterFlow",
    "cancelInitialHomeLoadTimeout",
    "cancelModernCameraFollow",
    "cancelModernSidebarPillAutoCollapse",
    "cancelPendingContinueWatchingEnter",
    "cancelPendingContinueWatchingHold",
    "cancelPendingHeroFocus",
    "cancelScheduledRender",
    "clearFocusedPosterFlowState",
    "clearHomeTrailerLayers",
    "collapseFocusedPoster",
    "destroyHomeHoldDialog",
    "endModernVerticalFastScroll",
    "persistCurrentFocusState",
    "stopHeroRotation",
    "teardownContinueWatchingProgressiveRendering",
    "teardownGridStickyHeader",
    "teardownModernTrackScrollPagination",
    "unlockHomeHoldFocus"
  ].forEach((name) => {
    screen[name] = () => {};
  });
  return { screen, calls };
}

{
  const { screen, calls } = buildScreen({ platform: "vidaa" });
  screen.cleanup();
  assert.equal(screen.homeDomPreserved, true, "VIDAA preserves the rendered Home");
  assert.ok(calls.classes.includes("add:home-dom-preserved"));
  assert.equal(calls.released, 0, "retained posters keep their artwork");
  assert.equal(calls.hidden, 0, "a preserved Home is not emptied");
}
{
  const { screen, calls } = buildScreen({ platform: "vidaa", rows: [] });
  screen.cleanup();
  assert.equal(screen.homeDomPreserved, false, "an empty Home is still discarded");
  assert.equal(calls.released, 1);
}
{
  const { screen } = buildScreen({ platform: "browser" });
  screen.cleanup();
  assert.equal(screen.homeDomPreserved, false, "the desktop browser keeps discarding Home");
}
assert.match(
  mountSource,
  /canResumePreservedTvHome = Boolean\(\s*\/\/[^\n]*\n\s*\(Platform\.isTizen\(\) \|\| Platform\.isWebOS\(\) \|\| Platform\.isVidaa\?\.\(\)\)/,
  "mount resumes the preserved Home on VIDAA as well"
);
console.log(
  "VIDAA Home preserve checks passed: retained on VIDAA, discarded when empty or in the browser."
);
