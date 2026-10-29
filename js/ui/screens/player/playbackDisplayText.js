import { readableStreamText } from "../../../core/streams/streamDisplayText.js";
import { Environment } from "../../../platform/environment.js";

export function normalizePlaybackDisplayLineBreaks(value = "") {
  return String(value ?? "").replace(/\\r\\n|\\n|\\r/g, "\n");
}

export function formatPlaybackSourceName(value = "") {
  const readableValue = readableStreamText(value, Environment);
  return normalizePlaybackDisplayLineBreaks(readableValue)
    .replace(/\r\n|\r|\n/g, " · ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolvePlaybackSourceName(stream = {}) {
  if (stream?.isSynthetic) {
    return "";
  }

  return (
    formatPlaybackSourceName(stream?.name) ||
    formatPlaybackSourceName(stream?.addonName).replace(/^Addon$/i, "")
  );
}
