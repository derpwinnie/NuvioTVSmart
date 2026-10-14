// With automatic source selection, Android goes straight from Detail/Home to a
// "finding source" screen and never shows the source list. VIDAA showed the list
// (skeleton cards) for a moment before the player opened. Decide when the stream
// screen should show the existing "finding source" overlay instead.
export function shouldShowVidaaAutoPlaySelecting({
  isVidaa = false,
  isBackNavigation = false,
  manualSelection = false,
  autoPlayMode = "MANUAL",
  autoPlayEnabled = false
} = {}) {
  return Boolean(
    isVidaa &&
    !isBackNavigation &&
    !manualSelection &&
    String(autoPlayMode || "MANUAL").toUpperCase() !== "MANUAL" &&
    autoPlayEnabled
  );
}
