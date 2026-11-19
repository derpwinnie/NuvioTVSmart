// VIDAA port: the player methods VIDAA adds, kept outside upstream's numbered
// playerScreenMethods-NN files so upstream releases never take their names.
import { createPlayerScreenVidaaAudioSupportMethods } from "./playerScreenVidaaAudioSupport.js";
import { createPlayerScreenVidaaSourceFailureMethods } from "./playerScreenVidaaSourceFailure.js";

export function createPlayerScreenVidaaMethods() {
  return {
    ...createPlayerScreenVidaaAudioSupportMethods(),
    ...createPlayerScreenVidaaSourceFailureMethods()
  };
}
