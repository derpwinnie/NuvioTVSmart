// VIDAA port: focus helpers for screen.js. Outside VIDAA they are exactly
// upstream's focusWithoutScroll / plain focus(); on VIDAA they also reset the
// document origin, which the VIDAA browser can shift after a focus even with
// preventScroll.
import { Platform } from "../../platform/index.js";
import { focusWithoutScroll as focusWithoutScrollBase } from "./focusWithoutScroll.js";

function restoreVidaaViewportOrigin() {
  const documentRef = globalThis?.document;
  try {
    if (documentRef?.documentElement) {
      documentRef.documentElement.scrollLeft = 0;
      documentRef.documentElement.scrollTop = 0;
    }
    if (documentRef?.body) {
      documentRef.body.scrollLeft = 0;
      documentRef.body.scrollTop = 0;
    }
    globalThis?.scrollTo?.(0, 0);
  } catch (_) {
    // Older VIDAA browsers may expose only part of the scroll API.
  }
}

export function scheduleVidaaViewportRestore() {
  if (!Platform.isVidaa()) {
    return;
  }
  restoreVidaaViewportOrigin();
  try {
    globalThis?.requestAnimationFrame?.(() => restoreVidaaViewportOrigin());
  } catch (_) {}
}

export function focusWithoutScroll(node, options) {
  const result = focusWithoutScrollBase(node, options);
  scheduleVidaaViewportRestore();
  return result;
}

// The first focus of a screen: upstream lets the browser scroll to it, VIDAA
// must not move the document.
export function focusRouteEntry(node) {
  if (!Platform.isVidaa()) {
    node?.focus?.();
    return;
  }
  focusWithoutScroll(node);
}

// After a directional move VIDAA scrolls the target into view itself.
export function revealVidaaDirectionalFocus(target) {
  if (!Platform.isVidaa()) {
    return;
  }
  try {
    if (typeof target?.scrollIntoView === "function") {
      target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
    }
  } catch (_) {}
  scheduleVidaaViewportRestore();
}
