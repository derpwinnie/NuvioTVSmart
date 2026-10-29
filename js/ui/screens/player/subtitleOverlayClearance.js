import { getSubtitleVerticalOffsetVh } from "../../../core/player/subtitleVerticalOffset.js";

// HTML bottom cues and capable ASS renderers receive selective placement.
// Authored positions and opaque native subtitle planes retain their coordinates.
export function syncHtmlSubtitleClearance(screen) {
  const refs = screen.uiRefs;
  const root = refs?.root;
  if (!root?.style || typeof root.getBoundingClientRect !== "function") return;
  const viewport = root.getBoundingClientRect();
  if (!(viewport.height > 0)) return;
  const gap = (viewport.height * 8) / 540;
  let clearance = 0;
  const include = (node, enabled) => {
    if (
      screen.subtitleDialogVisible ||
      !enabled ||
      !node ||
      node.classList.contains("hidden") ||
      !node.getClientRects().length
    )
      return;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return;
    const rect = node.getBoundingClientRect();
    if (rect.height > 0) clearance = Math.max(clearance, viewport.bottom - rect.top + gap);
  };
  include(
    refs.controlsBottom,
    screen.controlsVisible && !refs.controlsOverlay?.classList.contains("modal-blocked")
  );
  include(refs.skipIntro, true);
  include(refs.nextEpisodeCard, true);
  include(refs.seekOverlay, screen.seekOverlayVisible && !screen.controlsVisible);
  const bottom =
    (viewport.height *
      (8 - getSubtitleVerticalOffsetVh(screen.subtitleStyleSettings?.verticalOffset))) /
    100;
  const lift = Math.max(0, Math.min(viewport.height / 2, clearance) - bottom);
  const value = `${Math.round(lift)}px`;
  if (root.style.getPropertyValue("--player-subtitle-clearance") !== value)
    root.style.setProperty("--player-subtitle-clearance", value);
  screen.assSubtitleRenderer?.setPlacement?.({
    viewportBottom: viewport.bottom,
    overlayTop: clearance > 0 ? viewport.bottom - Math.min(viewport.height / 2, clearance) : null,
    userOffsetPx:
      -(
        viewport.height * getSubtitleVerticalOffsetVh(screen.subtitleStyleSettings?.verticalOffset)
      ) / 100
  });
}
