import { Platform } from "./index.js";

export const Environment = {
  isWebOS() {
    return Platform.isWebOS();
  },

  isTizen() {
    return Platform.isTizen();
  },

  isVidaa() {
    return Platform.isVidaa();
  },

  isBrowser() {
    return Platform.isBrowser();
  },

  isBackEvent(event) {
    return Platform.isBackEvent(event);
  },

  getDeviceLabel() {
    return Platform.getDeviceLabel();
  },

  // Which label glyphs the device can draw ({ emoji, flags, symbols, letters }),
  // or null when it draws them all (only VIDAA reports this).
  getGlyphSupport() {
    return Platform.getCapabilities?.()?.glyphs || null;
  }
};
